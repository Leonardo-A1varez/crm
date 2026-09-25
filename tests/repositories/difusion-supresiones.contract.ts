import { beforeEach, describe, expect, test } from "vitest";
import { parsearClavesBajas } from "@/lib/difusion/claves-bajas";
import { NotFoundError, PermissionDeniedError, ValidationError } from "@/lib/errors";
import { HasherTelefonoBajas } from "@/server/repositories/difusion-supresiones.hash";
import type { DifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import type { UUID } from "@/types/entities";

export interface DifusionSupresionesContractFixtures {
  /**
   * Un teléfono E.164 (sin `+`) que nadie usó. En Supabase las bajas no se
   * pueden borrar —ese es el punto de la tabla—, así que cada test necesita
   * números nuevos en vez de limpiar entre tests.
   */
  nuevoTelefono: () => string;
  /** Un id que no existe en `difusion_supresiones`. */
  desconocido: UUID;
}

export interface DifusionSupresionesContractOpciones {
  /**
   * El repo bajo prueba actúa como una persona admin. Sólo así se puede
   * reactivar una baja: con el service-role (sin `auth.uid()`) la base lo
   * rechaza, y eso también se prueba.
   */
  comoAdmin: boolean;
}

let secuencia = 0;
const DEFAULT_FIXTURES: DifusionSupresionesContractFixtures = {
  nuevoTelefono: () => `5939${String(10_000_000 + ++secuencia)}`,
  desconocido: "00000000-0000-4000-8000-000000000999",
};

export type DifusionSupresionesContractFixturesArg =
  | DifusionSupresionesContractFixtures
  | (() => DifusionSupresionesContractFixtures);

// Claves de prueba para la rotación: 32 bytes cada una. No son secretos de ningún entorno.
const K1 = Buffer.alloc(32, 11).toString("base64");
const K2 = Buffer.alloc(32, 22).toString("base64");
const SOLO_V1 = () => new HasherTelefonoBajas(parsearClavesBajas(`1:${K1}`, 1));
const V1_Y_V2 = () => new HasherTelefonoBajas(parsearClavesBajas(`1:${K1},2:${K2}`, 2));

/**
 * El repo bajo prueba. Con `hasher`, uno que hashea con esas claves y ve **las
 * mismas filas** que los demás repos de esta fábrica: así se prueba una
 * rotación, que en producción es otro proceso con otra configuración sobre la
 * misma tabla.
 */
export type MakeDifusionSupresionesRepo = (
  hasher?: HasherTelefonoBajas,
) => DifusionSupresionesRepository;

/** "593991234567" → "+593 99 123 4567": el mismo número como lo tipea una persona. */
function conFormato(telefono: string): string {
  return `+${telefono.slice(0, 3)} ${telefono.slice(3, 5)} ${telefono.slice(5, 8)} ${telefono.slice(8)}`;
}

export function runDifusionSupresionesContract(
  makeRepo: MakeDifusionSupresionesRepo,
  opciones: DifusionSupresionesContractOpciones,
  fixturesArg: DifusionSupresionesContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe(`DifusionSupresionesRepository contract (${opciones.comoAdmin ? "como admin" : "sin persona"})`, () => {
    let repo: DifusionSupresionesRepository;
    let f: DifusionSupresionesContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      f = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("registrar normaliza el teléfono y la baja nace activa", async () => {
      const tel = f.nuevoTelefono();

      const s = await repo.registrar({
        telefono: conFormato(tel),
        origen: "palabra_clave",
        detalle: "BAJA",
      });

      expect(s.origen).toBe("palabra_clave");
      expect(s.detalle).toBe("BAJA");
      expect(s.reactivada_at).toBeNull();
      expect(s.created_at).toBeInstanceOf(Date);
      expect(Number.isInteger(s.clave_version)).toBe(true);
      expect((await repo.activasPorTelefonos([tel])).map((x) => x.id)).toEqual([s.id]);
    });

    // Derecho de supresión (docs/data-retention.md §3): la baja tiene que
    // seguir bloqueando, pero el número no puede quedar legible.
    test("la baja no expone el teléfono ni su hash", async () => {
      const tel = f.nuevoTelefono();

      const s = await repo.registrar({ telefono: conFormato(tel), origen: "manual" });
      const [listada] = await repo.listar({ limite: 1 });

      for (const fila of [s, listada]) {
        expect(fila).not.toHaveProperty("telefono");
        expect(fila).not.toHaveProperty("telefono_hash");
        expect(JSON.stringify(fila)).not.toContain(tel);
      }
    });

    test("el mismo número escrito de dos formas es la misma baja", async () => {
      const tel = f.nuevoTelefono();
      const s = await repo.registrar({ telefono: `+${tel}`, origen: "manual" });

      const activas = await repo.activasPorTelefonos([conFormato(tel)]);

      expect(activas.map((x) => x.id)).toEqual([s.id]);
    });

    // AGENTS.md regla 9: la clave rota cada 90 días. Una baja escrita con la
    // versión 1 tiene que seguir bloqueando cuando las altas ya van con la 2.
    test("una baja hecha con la versión 1 sigue bloqueando después de pasar a la 2", async () => {
      const tel = f.nuevoTelefono();
      const antes = makeRepo(SOLO_V1());
      const despues = makeRepo(V1_Y_V2());

      const vieja = await antes.registrar({ telefono: tel, origen: "palabra_clave" });
      const encontradas = await despues.activasPorTelefonos([tel]);
      const otraVez = await despues.registrar({ telefono: tel, origen: "meta_131050" });

      expect(vieja.clave_version).toBe(1);
      expect(encontradas.map((x) => [x.id, x.telefono])).toEqual([[vieja.id, tel]]);
      expect(otraVez.id).toBe(vieja.id);
    });

    test("después de rotar, las altas nuevas se escriben con la versión activa", async () => {
      const s = await makeRepo(V1_Y_V2()).registrar({
        telefono: f.nuevoTelefono(),
        origen: "manual",
      });

      expect(s.clave_version).toBe(2);
    });

    test("un teléfono que no es de WhatsApp se rechaza", async () => {
      await expect(
        repo.registrar({ telefono: "ig:17841400000000", origen: "manual" }),
      ).rejects.toThrow(ValidationError);
    });

    // Una persona que escribe BAJA dos veces, o Meta que devuelve 131050 en
    // cada intento: una sola baja activa, la primera.
    test("registrar es idempotente: devuelve la baja activa que ya existía", async () => {
      const tel = f.nuevoTelefono();
      const primera = await repo.registrar({ telefono: tel, origen: "palabra_clave" });

      const segunda = await repo.registrar({ telefono: conFormato(tel), origen: "meta_131050" });

      expect(segunda.id).toBe(primera.id);
      expect(segunda.origen).toBe("palabra_clave");
    });

    test("activasPorTelefonos encuentra por número en cualquier formato", async () => {
      const suprimido = f.nuevoTelefono();
      const libre = f.nuevoTelefono();
      await repo.registrar({ telefono: suprimido, origen: "boton_baja" });

      const activas = await repo.activasPorTelefonos([conFormato(suprimido), libre, "ig:123"]);

      expect(activas.map((s) => s.telefono)).toEqual([suprimido]);
    });

    test("activasPorTelefonos con una lista vacía no consulta nada", async () => {
      expect(await repo.activasPorTelefonos([])).toEqual([]);
    });

    test("contarActivas suma las bajas nuevas", async () => {
      const antes = await repo.contarActivas();
      await repo.registrar({ telefono: f.nuevoTelefono(), origen: "manual" });
      await repo.registrar({ telefono: f.nuevoTelefono(), origen: "manual" });

      expect(await repo.contarActivas()).toBe(antes + 2);
    });

    test("listar trae la más reciente primero", async () => {
      const a = await repo.registrar({ telefono: f.nuevoTelefono(), origen: "manual" });
      const b = await repo.registrar({ telefono: f.nuevoTelefono(), origen: "manual" });

      const [primera, segunda] = await repo.listar({ limite: 2 });

      expect([primera?.id, segunda?.id]).toEqual([b.id, a.id]);
    });

    test("listar con un límite fuera de rango se rechaza", async () => {
      await expect(repo.listar({ limite: 0 })).rejects.toThrow(ValidationError);
    });

    test("reactivar sin un motivo de al menos 10 caracteres se rechaza", async () => {
      const s = await repo.registrar({ telefono: f.nuevoTelefono(), origen: "manual" });
      await expect(repo.reactivar(s.id, "corto")).rejects.toThrow(ValidationError);
    });

    test("reactivar una baja que no existe lanza NotFoundError", async () => {
      await expect(
        repo.reactivar(f.desconocido, "el cliente lo pidió por teléfono"),
      ).rejects.toThrow(NotFoundError);
    });

    if (!opciones.comoAdmin) {
      // §6.3: ni un import ni la API reactivan a quien se dio de baja.
      test("sin una persona admin, reactivar se rechaza y la baja sigue activa", async () => {
        const tel = f.nuevoTelefono();
        const s = await repo.registrar({ telefono: tel, origen: "palabra_clave" });

        await expect(repo.reactivar(s.id, "lo reactiva un proceso automático")).rejects.toThrow(
          PermissionDeniedError,
        );
        expect((await repo.activasPorTelefonos([tel])).map((x) => x.id)).toEqual([s.id]);
      });
    }

    if (opciones.comoAdmin) {
      test("una persona admin la reactiva: queda quién, cuándo y por qué", async () => {
        const tel = f.nuevoTelefono();
        const s = await repo.registrar({ telefono: tel, origen: "palabra_clave" });

        const r = await repo.reactivar(s.id, "  el cliente pidió volver a recibir promociones  ");

        expect(r.reactivada_at).toBeInstanceOf(Date);
        expect(r.reactivada_por).not.toBeNull();
        expect(r.reactivacion_motivo).toBe("el cliente pidió volver a recibir promociones");
        expect(r).not.toHaveProperty("telefono");
        expect(r.origen).toBe("palabra_clave");
        expect(await repo.activasPorTelefonos([tel])).toEqual([]);
      });

      test("una baja reactivada no se reactiva dos veces", async () => {
        const s = await repo.registrar({ telefono: f.nuevoTelefono(), origen: "manual" });
        await repo.reactivar(s.id, "el cliente pidió volver a recibir promociones");

        await expect(repo.reactivar(s.id, "otra vez el mismo pedido del cliente")).rejects.toThrow(
          NotFoundError,
        );
      });

      // Darse de baja otra vez después de una reactivación es una fila nueva:
      // la historia de la anterior no se pisa.
      test("después de reactivar se puede volver a dar de baja", async () => {
        const tel = f.nuevoTelefono();
        const vieja = await repo.registrar({ telefono: tel, origen: "manual" });
        await repo.reactivar(vieja.id, "el cliente pidió volver a recibir promociones");

        const nueva = await repo.registrar({
          telefono: tel,
          origen: "palabra_clave",
          detalle: "SALIR",
        });

        expect(nueva.id).not.toBe(vieja.id);
        expect((await repo.activasPorTelefonos([tel])).map((x) => x.id)).toEqual([nueva.id]);
      });
    }
  });
}
