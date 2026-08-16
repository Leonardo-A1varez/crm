import { beforeEach, describe, expect, test } from "vitest";
import { NotFoundError } from "@/lib/errors";
import type {
  ReglaEtiquetaInsert,
  ReglasEtiquetaRepository,
} from "@/server/repositories/reglas-etiqueta.repo";
import type { UUID } from "@/types/entities";

export interface ReglasEtiquetaContractFixtures {
  intentIds: { i1: UUID; i2: UUID };
  tagIds: { t1: UUID; t2: UUID };
  /** Un id que no existe en `reglas_etiqueta`. */
  desconocido: UUID;
}

const DEFAULT_FIXTURES: ReglasEtiquetaContractFixtures = {
  intentIds: { i1: "intent-1", i2: "intent-2" },
  tagIds: { t1: "tag-1", t2: "tag-2" },
  desconocido: "00000000-0000-4000-8000-000000000999",
};

export type ReglasEtiquetaContractFixturesArg =
  | ReglasEtiquetaContractFixtures
  | (() => ReglasEtiquetaContractFixtures);

function base(
  fixtures: ReglasEtiquetaContractFixtures,
  overrides: Partial<ReglaEtiquetaInsert> = {},
): ReglaEtiquetaInsert {
  return {
    intent_id: fixtures.intentIds.i1,
    tag_id: fixtures.tagIds.t1,
    condiciones_extra: null,
    activa: true,
    ...overrides,
  };
}

export function runReglasEtiquetaContract(
  makeRepo: () => ReglasEtiquetaRepository,
  fixturesArg: ReglasEtiquetaContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("ReglasEtiquetaRepository contract", () => {
    let repo: ReglasEtiquetaRepository;
    let fixtures: ReglasEtiquetaContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create devuelve la regla con id y created_at", async () => {
      const r = await repo.create(base(fixtures));

      expect(r.id).toBeTypeOf("string");
      expect(r.intent_id).toBe(fixtures.intentIds.i1);
      expect(r.tag_id).toBe(fixtures.tagIds.t1);
      expect(r.activa).toBe(true);
      expect(r.created_at).toBeInstanceOf(Date);
    });

    test("findById encuentra la que se creó", async () => {
      const creada = await repo.create(base(fixtures));
      expect((await repo.findById(creada.id))?.id).toBe(creada.id);
    });

    test("findById de una inexistente devuelve null", async () => {
      expect(await repo.findById(fixtures.desconocido)).toBeNull();
    });

    // Es lo que consulta el motor en cada turno del agente: devuelve TODAS las
    // que matchean, no la de mayor prioridad como su prima `reglas`. Acá no
    // compiten por el único lugar de la respuesta.
    test("listActiveByIntent devuelve todas las activas de ese intent", async () => {
      await repo.create(base(fixtures, { tag_id: fixtures.tagIds.t1 }));
      await repo.create(base(fixtures, { tag_id: fixtures.tagIds.t2 }));

      const activas = await repo.listActiveByIntent(fixtures.intentIds.i1);

      expect(activas).toHaveLength(2);
      expect(activas.map((r) => r.tag_id).sort()).toEqual(
        [fixtures.tagIds.t1, fixtures.tagIds.t2].sort(),
      );
    });

    test("listActiveByIntent excluye las apagadas", async () => {
      await repo.create(base(fixtures, { tag_id: fixtures.tagIds.t1, activa: false }));

      expect(await repo.listActiveByIntent(fixtures.intentIds.i1)).toEqual([]);
    });

    test("listActiveByIntent no mezcla intents", async () => {
      await repo.create(base(fixtures, { intent_id: fixtures.intentIds.i1 }));
      await repo.create(base(fixtures, { intent_id: fixtures.intentIds.i2 }));

      const deI1 = await repo.listActiveByIntent(fixtures.intentIds.i1);

      expect(deI1).toHaveLength(1);
      expect(deI1[0]?.intent_id).toBe(fixtures.intentIds.i1);
    });

    test("update apaga la regla sin borrarla", async () => {
      const creada = await repo.create(base(fixtures));

      const apagada = await repo.update(creada.id, { activa: false });

      expect(apagada.activa).toBe(false);
      expect(await repo.findById(creada.id)).not.toBeNull();
    });

    test("update de una inexistente lanza NotFoundError", async () => {
      await expect(repo.update(fixtures.desconocido, { activa: false })).rejects.toThrow(
        NotFoundError,
      );
    });

    test("delete la saca y es idempotente", async () => {
      const creada = await repo.create(base(fixtures));

      await repo.delete(creada.id);
      expect(await repo.findById(creada.id)).toBeNull();

      await expect(repo.delete(creada.id)).resolves.toBeUndefined();
    });

    test("list devuelve todas, activas y apagadas", async () => {
      await repo.create(base(fixtures, { tag_id: fixtures.tagIds.t1 }));
      await repo.create(base(fixtures, { tag_id: fixtures.tagIds.t2, activa: false }));

      expect(await repo.list()).toHaveLength(2);
    });

    // Las condiciones viajan como jsonb: si se pierden en el camino, el motor
    // aplicaría la etiqueta en turnos donde no corresponde.
    test("las condiciones extra sobreviven la ida y vuelta", async () => {
      const creada = await repo.create(
        base(fixtures, { condiciones_extra: { urgencia: "alta", current_stage: "cotizado" } }),
      );

      const leida = await repo.findById(creada.id);

      expect(leida?.condiciones_extra).toEqual({ urgencia: "alta", current_stage: "cotizado" });
    });
  });
}
