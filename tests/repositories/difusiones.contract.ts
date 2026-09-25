import { beforeEach, describe, expect, test } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Grupo } from "@/lib/ui/condiciones";
import type { DifusionInsert, DifusionesRepository } from "@/server/repositories/difusiones.repo";
import type { UUID } from "@/types/entities";

export interface DifusionesContractFixtures {
  /** Un usuario que exista, para `creada_por`. `null` si el entorno no tiene uno. */
  usuarioId: UUID | null;
  /** Un id que no existe en `difusiones`. */
  desconocido: UUID;
}

const DEFAULT_FIXTURES: DifusionesContractFixtures = {
  usuarioId: "usuario-1",
  desconocido: "00000000-0000-4000-8000-000000000999",
};

export type DifusionesContractFixturesArg =
  | DifusionesContractFixtures
  | (() => DifusionesContractFixtures);

// Árbol de prueba armado a mano para este contrato.
const AUDIENCIA: Grupo = {
  id: "raiz",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r1",
      clase: "regla",
      campoId: "etapa",
      comparador: "tiene",
      valor: { tipo: "opciones", valores: ["cotizado", "negociando"] },
    },
    {
      id: "g1",
      clase: "grupo",
      operador: "o",
      hijos: [
        {
          id: "r2",
          clase: "regla",
          campoId: "ultima_actividad",
          comparador: "mayor_que",
          valor: { tipo: "numero", valor: 45 },
        },
      ],
    },
  ],
};

const VACIA: Grupo = { id: "raiz", clase: "grupo", operador: "y", hijos: [] };

function base(f: DifusionesContractFixtures, over: Partial<DifusionInsert> = {}): DifusionInsert {
  return { nombre: "Promo frenos", audiencia: AUDIENCIA, creada_por: f.usuarioId, ...over };
}

/** Con qué sale: sin nombre e idioma de plantilla una difusión no deja de ser borrador. */
const PLANTILLA = {
  plantilla_nombre: "promo_frenos_v3",
  plantilla_categoria: "marketing",
  plantilla_idioma: "es_AR",
} as const;

export function runDifusionesContract(
  makeRepo: () => DifusionesRepository,
  fixturesArg: DifusionesContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("DifusionesRepository contract", () => {
    let repo: DifusionesRepository;
    let f: DifusionesContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      f = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    // Seguro por defecto (§7.4): sin exenciones, sin canary, congelada.
    test("nace borrador y con los defaults seguros", async () => {
      const d = await repo.create(base(f));

      expect(d.id).toBeTypeOf("string");
      expect(d.estado).toBe("borrador");
      expect(d.audiencia_modo).toBe("congelada");
      expect(d.incluir_en_negociacion).toBe(false);
      expect(d.exenta_tope_frecuencia).toBe(false);
      expect(d.canary_tamano).toBeNull();
      expect(d.plantilla_nombre).toBeNull();
      expect(d.plantilla_categoria).toBeNull();
      expect(d.creada_por).toBe(f.usuarioId);
      expect(d.created_at).toBeInstanceOf(Date);
    });

    // Mandarle a toda la base es una elección explícita, nunca un árbol vacío.
    test("toda la base nace apagada", async () => {
      const d = await repo.create(base(f));
      expect(d.audiencia_toda_la_base).toBe(false);
    });

    test("toda la base se guarda, con el árbol vacío", async () => {
      const d = await repo.create(base(f, { audiencia: VACIA, audiencia_toda_la_base: true }));
      expect((await repo.findById(d.id))?.audiencia_toda_la_base).toBe(true);
    });

    test("toda la base con condiciones es una contradicción y se rechaza", async () => {
      await expect(repo.create(base(f, { audiencia_toda_la_base: true }))).rejects.toThrow(
        ValidationError,
      );
    });

    test("un borrador se guarda con el árbol vacío, pero no se programa sin elegir toda la base", async () => {
      const d = await repo.create(base(f, { audiencia: VACIA }));
      await expect(
        repo.update(d.id, { estado: "programada", programada_para: new Date() }),
      ).rejects.toThrow(ValidationError);
    });

    test("update prende toda la base vaciando el árbol en el mismo cambio", async () => {
      const d = await repo.create(base(f));
      const u = await repo.update(d.id, { audiencia: VACIA, audiencia_toda_la_base: true });
      expect(u.audiencia_toda_la_base).toBe(true);
      expect(u.audiencia.hijos).toHaveLength(0);
    });

    test("la audiencia sobrevive la ida y vuelta tal cual", async () => {
      const d = await repo.create(base(f));
      expect((await repo.findById(d.id))?.audiencia).toEqual(AUDIENCIA);
    });

    test("rechaza una audiencia que no es el árbol de condiciones", async () => {
      await expect(
        repo.create(base(f, { audiencia: { clase: "regla" } as unknown as Grupo })),
      ).rejects.toThrow(ValidationError);
    });

    test("rechaza una plantilla sin categoría", async () => {
      await expect(repo.create(base(f, { plantilla_nombre: "promo_frenos_v3" }))).rejects.toThrow(
        ValidationError,
      );
    });

    test("guarda plantilla, exenciones y canary", async () => {
      const d = await repo.create(
        base(f, {
          plantilla_nombre: "promo_frenos_v3",
          plantilla_categoria: "marketing",
          incluir_en_negociacion: true,
          exenta_tope_frecuencia: true,
          canary_tamano: 200,
          audiencia_modo: "dinamica",
        }),
      );
      const leida = await repo.findById(d.id);
      expect(leida?.plantilla_nombre).toBe("promo_frenos_v3");
      expect(leida?.plantilla_categoria).toBe("marketing");
      expect(leida?.incluir_en_negociacion).toBe(true);
      expect(leida?.exenta_tope_frecuencia).toBe(true);
      expect(leida?.canary_tamano).toBe(200);
      expect(leida?.audiencia_modo).toBe("dinamica");
    });

    test("no sale sin idioma de plantilla: Meta no la encuentra sin él", async () => {
      const d = await repo.create(
        base(f, { plantilla_nombre: "promo_frenos_v3", plantilla_categoria: "marketing" }),
      );
      await expect(
        repo.update(d.id, { estado: "programada", programada_para: new Date() }),
      ).rejects.toThrow(ValidationError);
    });

    test("guarda idioma y variables de la plantilla, y las devuelve", async () => {
      const parametros = [
        { valor: "{{lead.nombre}}", respaldo: "cliente" },
        { valor: "{{lead.vehiculo_modelo}}", respaldo: "" },
      ];
      const d = await repo.create(base(f, { ...PLANTILLA, plantilla_parametros: parametros }));
      const leida = await repo.findById(d.id);
      expect(leida?.plantilla_idioma).toBe("es_AR");
      expect(leida?.plantilla_parametros).toEqual(parametros);
    });

    test("actualizarSiEstado no pisa una difusión que cambió de estado", async () => {
      const d = await repo.create(base(f, PLANTILLA));
      await repo.update(d.id, { estado: "programada", programada_para: new Date() });

      const movida = await repo.actualizarSiEstado(d.id, ["programada"], {
        estado: "enviando",
        iniciada_at: new Date(),
      });
      expect(movida?.estado).toBe("enviando");

      // Una persona la pausa; el motor, que creía que seguía enviando, no la completa.
      await repo.update(d.id, { estado: "en_revision" });
      const noMovida = await repo.actualizarSiEstado(d.id, ["enviando"], {
        estado: "completada",
        finalizada_at: new Date(),
      });
      expect(noMovida).toBeNull();
      expect((await repo.findById(d.id))?.estado).toBe("en_revision");
    });

    test("el motivo de revisión va sólo con la difusión en revisión", async () => {
      const d = await repo.create(base(f, PLANTILLA));
      await repo.update(d.id, { estado: "enviando", programada_para: new Date() });
      await expect(repo.update(d.id, { motivo_revision: "132015" })).rejects.toThrow(
        ValidationError,
      );
      const u = await repo.update(d.id, {
        estado: "en_revision",
        motivo_revision: "Meta pausó la plantilla (132015)",
      });
      expect(u.motivo_revision).toBe("Meta pausó la plantilla (132015)");
    });

    test("listarConCola trae programadas y enviándose, la programada antes primero", async () => {
      const a = await repo.create(base(f, { ...PLANTILLA, nombre: "A" }));
      const b = await repo.create(base(f, { ...PLANTILLA, nombre: "B" }));
      const c = await repo.create(base(f, { ...PLANTILLA, nombre: "C" }));
      await repo.update(a.id, {
        estado: "programada",
        programada_para: new Date("2026-10-02T10:00:00.000Z"),
      });
      await repo.update(b.id, {
        estado: "enviando",
        programada_para: new Date("2026-10-01T10:00:00.000Z"),
      });
      await repo.update(c.id, { estado: "en_revision", programada_para: new Date() });

      const ids = (await repo.listarConCola()).map((d) => d.id);
      expect(ids.filter((id) => [a.id, b.id, c.id].includes(id))).toEqual([b.id, a.id]);
    });

    test("findById de una inexistente devuelve null", async () => {
      expect(await repo.findById(f.desconocido)).toBeNull();
    });

    test("update cambia lo pedido y devuelve la fila", async () => {
      const d = await repo.create(base(f, PLANTILLA));
      const programada = new Date("2026-10-01T13:00:00.000Z");

      const u = await repo.update(d.id, { estado: "programada", programada_para: programada });

      expect(u.estado).toBe("programada");
      expect(u.programada_para?.toISOString()).toBe(programada.toISOString());
      expect(u.nombre).toBe(d.nombre);
    });

    test("update de una inexistente lanza NotFoundError", async () => {
      await expect(repo.update(f.desconocido, { nombre: "x" })).rejects.toThrow(NotFoundError);
    });

    test("programada sin fecha se rechaza", async () => {
      const d = await repo.create(base(f));
      await expect(repo.update(d.id, { estado: "programada" })).rejects.toThrow(ValidationError);
    });

    // "Detener dice con precisión qué pasó" (§8.5).
    test("detenida exige motivo y fecha de fin", async () => {
      const d = await repo.create(base(f, PLANTILLA));
      await expect(
        repo.update(d.id, { estado: "detenida", finalizada_at: new Date() }),
      ).rejects.toThrow(ValidationError);

      const u = await repo.update(d.id, {
        estado: "detenida",
        finalizada_at: new Date(),
        motivo_detencion: "368: cuenta restringida",
      });
      expect(u.estado).toBe("detenida");
      expect(u.motivo_detencion).toBe("368: cuenta restringida");
    });

    test("completada sin fecha de fin se rechaza", async () => {
      const d = await repo.create(base(f));
      await expect(repo.update(d.id, { estado: "completada" })).rejects.toThrow(ValidationError);
    });

    test("update rechaza una audiencia rota", async () => {
      const d = await repo.create(base(f));
      await expect(
        repo.update(d.id, { audiencia: { clase: "grupo" } as unknown as Grupo }),
      ).rejects.toThrow(ValidationError);
    });

    test("delete de un borrador lo saca, y es idempotente", async () => {
      const d = await repo.create(base(f));

      await repo.delete(d.id);
      expect(await repo.findById(d.id)).toBeNull();

      await expect(repo.delete(d.id)).resolves.toBeUndefined();
    });

    // Una difusión que salió es el registro de a quién se le mandó qué: se
    // detiene, no se borra.
    test("delete de una que no es borrador se rechaza y la difusión sigue", async () => {
      const d = await repo.create(base(f, PLANTILLA));
      await repo.update(d.id, { estado: "programada", programada_para: new Date() });

      await expect(repo.delete(d.id)).rejects.toThrow(ValidationError);
      expect(await repo.findById(d.id)).not.toBeNull();
    });

    test("list trae las más recientes primero y respeta el límite", async () => {
      const a = await repo.create(base(f, { nombre: "A" }));
      const b = await repo.create(base(f, { nombre: "B" }));
      const c = await repo.create(base(f, { nombre: "C" }));

      const dos = await repo.list({ limite: 2 });

      expect(dos.map((d) => d.id)).toEqual([c.id, b.id]);
      expect((await repo.list({ limite: 50 })).map((d) => d.id)).toContain(a.id);
    });

    // PostgREST corta en 1.000 filas sin avisar (AGENTS.md, lección 12): el
    // límite es explícito y acotado.
    test("list con un límite fuera de rango se rechaza", async () => {
      await expect(repo.list({ limite: 0 })).rejects.toThrow(ValidationError);
      await expect(repo.list({ limite: 1001 })).rejects.toThrow(ValidationError);
    });
  });
}
