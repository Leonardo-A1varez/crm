import { beforeEach, describe, expect, test } from "vitest";
import type {
  BorradoresIaRepository,
  ResultadoIniciar,
} from "@/server/repositories/borradores-ia.repo";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { UUID } from "@/types/entities";

export interface BorradoresIaContractFixtures {
  conversacionId: UUID;
  otraConversacionId: UUID;
  leadSessionId: UUID;
  otraLeadSessionId: UUID;
  usuarioId: UUID;
  reglaId: UUID;
  /** El entrante con el que arranca `conversacionId` (es el último hasta que llegue otro). */
  primerEntranteId: UUID;
  /** El (único) entrante de `otraConversacionId`. */
  entranteDeOtraId: UUID;
  /** Hace llegar un entrante nuevo a `conversacionId`: pasa a ser el último. */
  nuevoEntrante(): Promise<UUID>;
}

export type BorradoresIaContractFixturesArg =
  | BorradoresIaContractFixtures
  | (() => BorradoresIaContractFixtures | Promise<BorradoresIaContractFixtures>);

function idDe(r: ResultadoIniciar): UUID {
  if (r.resultado === "obsoleto") throw new Error("se esperaba un borrador y salió 'obsoleto'");
  return r.borradorId;
}

export function runBorradoresIaContract(
  makeRepo: () => BorradoresIaRepository,
  fixturesArg: BorradoresIaContractFixturesArg,
) {
  describe("BorradoresIaRepository contract", () => {
    let repo: BorradoresIaRepository;
    let f: BorradoresIaContractFixtures;

    beforeEach(async () => {
      repo = makeRepo();
      f = typeof fixturesArg === "function" ? await fixturesArg() : fixturesArg;
    });

    const arrancar = (mensajeOrigenId?: UUID, extra: { forzar?: boolean } = {}) =>
      repo.iniciar({
        conversacionId: f.conversacionId,
        leadSessionId: f.leadSessionId,
        mensajeOrigenId: mensajeOrigenId ?? f.primerEntranteId,
        ...extra,
      });

    test("iniciar crea un borrador redactando para el último entrante", async () => {
      const r = await arrancar();
      expect(r.resultado).toBe("creado");

      const b = await repo.findById(idDe(r));
      expect(b).toMatchObject({
        estado: "redactando",
        conversacion_id: f.conversacionId,
        lead_session_id: f.leadSessionId,
        mensaje_origen_id: f.primerEntranteId,
        contenido: null,
        origen: null,
        regla_id: null,
        error_codigo: null,
        usado_at: null,
      });
      expect(b?.created_at).toBeInstanceOf(Date);
    });

    test("iniciar es idempotente por mensaje_origen_id (R6)", async () => {
      const primera = await arrancar();
      const segunda = await arrancar();

      expect(segunda).toEqual({
        resultado: "existente",
        borradorId: idDe(primera),
        estado: "redactando",
      });
    });

    test("un borrador ya usado tampoco se vuelve a arrancar solo", async () => {
      const id = idDe(await arrancar());
      await repo.completar(id, { contenido: "Listo", origen: "ia", reglaId: null });
      await repo.marcarUsado(id, { via: "copiar", usuarioId: f.usuarioId });

      const otra = await arrancar();

      expect(otra).toEqual({ resultado: "existente", borradorId: id, estado: "usado" });
    });

    test("forzar descarta el vigente y crea otro para el mismo entrante (Regenerar)", async () => {
      const id1 = idDe(await arrancar());
      const r2 = await arrancar(undefined, { forzar: true });

      expect(r2.resultado).toBe("creado");
      expect(idDe(r2)).not.toBe(id1);
      expect((await repo.findById(id1))?.estado).toBe("descartado");
      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(idDe(r2));
    });

    test("un origen que ya no es el último entrante es obsoleto y no crea nada", async () => {
      await f.nuevoEntrante();

      const r = await arrancar(f.primerEntranteId);

      expect(r).toEqual({ resultado: "obsoleto" });
      expect(await repo.findActualByConversacion(f.conversacionId)).toBeNull();
    });

    test("el borrador del mensaje nuevo reemplaza al vigente y el viejo no puede pisarlo", async () => {
      const id1 = idDe(await arrancar());
      const nuevo = await f.nuevoEntrante();
      const id2 = idDe(await arrancar(nuevo));

      expect((await repo.findById(id1))?.estado).toBe("descartado");
      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(id2);

      // El trabajo del turno viejo termina tarde: no debe resucitar su borrador.
      expect(
        await repo.completar(id1, { contenido: "respuesta vieja", origen: "ia", reglaId: null }),
      ).toBeNull();
      expect((await repo.findById(id1))?.contenido).toBeNull();

      const ok = await repo.completar(id2, {
        contenido: "respuesta nueva",
        origen: "ia",
        reglaId: null,
      });
      expect(ok?.estado).toBe("listo");
    });

    test("completar pasa redactando a listo con texto, origen y regla, y no se repite", async () => {
      const id = idDe(await arrancar());

      const b = await repo.completar(id, {
        contenido: "Hola, tenemos ese filtro.",
        origen: "regla",
        reglaId: f.reglaId,
      });

      expect(b).toMatchObject({
        estado: "listo",
        contenido: "Hola, tenemos ese filtro.",
        origen: "regla",
        regla_id: f.reglaId,
      });
      expect(
        await repo.completar(id, { contenido: "otra", origen: "ia", reglaId: null }),
      ).toBeNull();
      expect((await repo.findById(id))?.contenido).toBe("Hola, tenemos ese filtro.");
    });

    test("marcarError solo desde redactando", async () => {
      const id = idDe(await arrancar());

      const e = await repo.marcarError(id, "llm_error");
      expect(e).toMatchObject({ estado: "error", error_codigo: "llm_error" });
      expect(await repo.marcarError(id, "tope_diario")).toBeNull();
      expect((await repo.findById(id))?.error_codigo).toBe("llm_error");
    });

    test("un borrador en error sigue vigente hasta que Regenerar lo reemplaza", async () => {
      const id1 = idDe(await arrancar());
      await repo.marcarError(id1, "llm_error");

      expect((await repo.findActualByConversacion(f.conversacionId))?.estado).toBe("error");

      const id2 = idDe(await arrancar(undefined, { forzar: true }));
      expect((await repo.findById(id1))?.estado).toBe("descartado");
      expect((await repo.findById(id2))?.estado).toBe("redactando");
    });

    test("marcarUsado funciona una sola vez", async () => {
      const id = idDe(await arrancar());
      await repo.completar(id, { contenido: "Texto", origen: "ia", reglaId: null });

      expect(await repo.marcarUsado(id, { via: "insertar", usuarioId: f.usuarioId })).toBe(
        "marcado",
      );
      expect(await repo.marcarUsado(id, { via: "copiar", usuarioId: f.usuarioId })).toBe(
        "ya_usado",
      );

      const b = await repo.findById(id);
      expect(b).toMatchObject({ estado: "usado", usado_via: "insertar", usado_por: f.usuarioId });
      expect(b?.usado_at).toBeInstanceOf(Date);
    });

    test("marcarUsado sobre un borrador que no está listo (o no existe) es no_disponible", async () => {
      const id = idDe(await arrancar()); // redactando

      expect(await repo.marcarUsado(id, { via: "copiar", usuarioId: f.usuarioId })).toBe(
        "no_disponible",
      );
      expect(
        await repo.marcarUsado(crypto.randomUUID(), { via: "copiar", usuarioId: f.usuarioId }),
      ).toBe("no_disponible");
    });

    test("usado no compite por el índice: después se puede arrancar el siguiente", async () => {
      const id1 = idDe(await arrancar());
      await repo.completar(id1, { contenido: "Uno", origen: "ia", reglaId: null });
      await repo.marcarUsado(id1, { via: "abrir_web", usuarioId: null });

      const nuevo = await f.nuevoEntrante();
      const r2 = await arrancar(nuevo);

      expect(r2.resultado).toBe("creado");
      expect((await repo.findById(id1))?.estado).toBe("usado");
      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(idDe(r2));
    });

    test("descartarVigentes descarta redactando/listo/error y no toca usado", async () => {
      const id1 = idDe(await arrancar());
      expect(await repo.descartarVigentes(f.conversacionId)).toBe(1);
      expect((await repo.findById(id1))?.estado).toBe("descartado");
      expect(await repo.descartarVigentes(f.conversacionId)).toBe(0);

      const nuevo = await f.nuevoEntrante();
      const id2 = idDe(await arrancar(nuevo));
      await repo.completar(id2, { contenido: "Dos", origen: "ia", reglaId: null });
      await repo.marcarUsado(id2, { via: "copiar", usuarioId: f.usuarioId });
      expect(await repo.descartarVigentes(f.conversacionId)).toBe(0);
      expect((await repo.findById(id2))?.estado).toBe("usado");
    });

    test("descartar pasa un vigente a descartado una sola vez", async () => {
      const id = idDe(await arrancar());
      expect(await repo.descartar(id)).toBe(true);
      expect(await repo.descartar(id)).toBe(false);
      expect((await repo.findById(id))?.estado).toBe("descartado");
    });

    test("findActualByConversacion devuelve el más reciente que no está descartado", async () => {
      const id1 = idDe(await arrancar());
      await repo.completar(id1, { contenido: "Uno", origen: "ia", reglaId: null });
      await repo.marcarUsado(id1, { via: "copiar", usuarioId: f.usuarioId });

      const nuevo = await f.nuevoEntrante();
      const id2 = idDe(await arrancar(nuevo));
      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(id2);

      await repo.descartar(id2);
      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(id1);
    });

    test("findById con un id inexistente devuelve null", async () => {
      expect(await repo.findById(crypto.randomUUID())).toBeNull();
      expect(await repo.findById("no-es-un-uuid")).toBeNull();
    });

    test("listListosPorConversacionIds devuelve solo las conversaciones con un borrador listo", async () => {
      const id = idDe(await arrancar());
      await repo.completar(id, { contenido: "Listo", origen: "ia", reglaId: null });
      await repo.iniciar({
        conversacionId: f.otraConversacionId,
        leadSessionId: f.otraLeadSessionId,
        mensajeOrigenId: f.entranteDeOtraId,
      }); // queda redactando

      expect(
        await repo.listListosPorConversacionIds([f.conversacionId, f.otraConversacionId]),
      ).toEqual([f.conversacionId]);
      expect(await repo.listListosPorConversacionIds([])).toEqual([]);
    });

    test("las conversaciones no se pisan entre sí", async () => {
      const a = idDe(await arrancar());
      const b = idDe(
        await repo.iniciar({
          conversacionId: f.otraConversacionId,
          leadSessionId: f.otraLeadSessionId,
          mensajeOrigenId: f.entranteDeOtraId,
        }),
      );

      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(a);
      expect((await repo.findActualByConversacion(f.otraConversacionId))?.id).toBe(b);
    });

    // Paridad con lo que la base rechaza (CHECK / FK / RPC): el InMemory tira la
    // misma clase de DomainError que `mapPostgrestError` le da a Supabase.
    test("marcarError rechaza un código que no es corto ni en minúsculas (CHECK) con ValidationError", async () => {
      const id = idDe(await arrancar());

      await expect(repo.marcarError(id, "El proveedor dijo: 500 Internal")).rejects.toThrow(
        ValidationError,
      );
      await expect(repo.marcarError(id, "")).rejects.toThrow(ValidationError);
      expect((await repo.findById(id))?.estado).toBe("redactando");
    });

    test("completar con un origen fuera de dominio (CHECK) es ValidationError", async () => {
      const id = idDe(await arrancar());

      await expect(
        repo.completar(id, { contenido: "Texto", origen: "humano" as never, reglaId: null }),
      ).rejects.toThrow(ValidationError);
      expect((await repo.findById(id))?.estado).toBe("redactando");
    });

    test("marcarUsado con una vía fuera de dominio (CHECK) es ValidationError", async () => {
      const id = idDe(await arrancar());
      await repo.completar(id, { contenido: "Texto", origen: "ia", reglaId: null });

      await expect(
        repo.marcarUsado(id, { via: "telepatia" as never, usuarioId: null }),
      ).rejects.toThrow(ValidationError);
      expect((await repo.findById(id))?.estado).toBe("listo");
    });

    test("completar con una regla inexistente (FK) es ConflictError y no cambia el borrador", async () => {
      const id = idDe(await arrancar());

      await expect(
        repo.completar(id, { contenido: "Texto", origen: "regla", reglaId: crypto.randomUUID() }),
      ).rejects.toThrow(ConflictError);
      expect((await repo.findById(id))?.estado).toBe("redactando");
    });

    test("marcarUsado con un usuario inexistente (FK) es ConflictError y no cambia el borrador", async () => {
      const id = idDe(await arrancar());
      await repo.completar(id, { contenido: "Texto", origen: "ia", reglaId: null });

      await expect(
        repo.marcarUsado(id, { via: "copiar", usuarioId: crypto.randomUUID() }),
      ).rejects.toThrow(ConflictError);
      expect((await repo.findById(id))?.estado).toBe("listo");
    });

    test("iniciar sobre una conversación inexistente es NotFoundError", async () => {
      await expect(
        repo.iniciar({
          conversacionId: crypto.randomUUID(),
          leadSessionId: f.leadSessionId,
          mensajeOrigenId: f.primerEntranteId,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    test("iniciar con una sesión inexistente (FK) es ConflictError y no deja borrador", async () => {
      await expect(
        repo.iniciar({
          conversacionId: f.conversacionId,
          leadSessionId: crypto.randomUUID(),
          mensajeOrigenId: f.primerEntranteId,
        }),
      ).rejects.toThrow(ConflictError);
      expect(await repo.findActualByConversacion(f.conversacionId)).toBeNull();
    });
  });
}
