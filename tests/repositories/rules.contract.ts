import { describe, expect, test, beforeEach } from "vitest";
import type { ReglaInsert, RulesRepository } from "@/server/repositories/rules.repo";
import type { UUID } from "@/types/entities";

/**
 * Fixtures inyectables para que el contract corra contra impls con FKs reales
 * (Supabase reglas → intents). Default strings para preservar test InMemory.
 */
export interface RulesContractFixtures {
  intentIds: {
    base: UUID;
    A: UUID;
    B: UUID;
    I: UUID;
    T: UUID;
    X: UUID;
    Y: UUID;
    Z: UUID;
    /** Intent existente sin reglas — usado en listActiveByIntent que espera []. */
    empty: UUID;
  };
}

const DEFAULT_FIXTURES: RulesContractFixtures = {
  intentIds: {
    base: "intent-1",
    A: "intent-A",
    B: "intent-B",
    I: "I",
    T: "T",
    X: "X",
    Y: "Y",
    Z: "Z",
    empty: "empty",
  },
};

export type RulesContractFixturesArg = RulesContractFixtures | (() => RulesContractFixtures);

function baseInsert(intentId: UUID, overrides: Partial<ReglaInsert> = {}): ReglaInsert {
  return {
    intent_id: intentId,
    condiciones_extra: null,
    respuesta_tipo: "text",
    respuesta_contenido: "Hola, gracias por escribir.",
    prioridad: 100,
    activa: true,
    ...overrides,
  };
}

export function runRulesContract(
  makeRepo: () => RulesRepository,
  fixturesArg: RulesContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("RulesRepository contract", () => {
    let repo: RulesRepository;
    let fixtures: RulesContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create asigna id + created_at + persiste", async () => {
      const r = await repo.create(baseInsert(fixtures.intentIds.base));
      expect(r.id).toBeTypeOf("string");
      expect(r.created_at).toBeInstanceOf(Date);
      expect(r.intent_id).toBe(fixtures.intentIds.base);
      expect(await repo.findById(r.id)).toEqual(r);
    });

    test("findById null cuando id falta", async () => {
      expect(await repo.findById("missing")).toBeNull();
    });

    test("update aplica patch pero bloquea cambio de intent_id", async () => {
      const r = await repo.create(baseInsert(fixtures.intentIds.base));
      const patched = await repo.update(r.id, {
        prioridad: 200,
        activa: false,
        respuesta_contenido: "Modificado",
      });
      expect(patched.prioridad).toBe(200);
      expect(patched.activa).toBe(false);
      expect(patched.respuesta_contenido).toBe("Modificado");
      expect(patched.intent_id).toBe(r.intent_id);
      expect(patched.created_at).toEqual(r.created_at);
    });

    test("update throws cuando id falta", async () => {
      await expect(repo.update("missing", { prioridad: 1 })).rejects.toThrow();
    });

    test("listActiveByIntent solo retorna activa=true del intent", async () => {
      await repo.create(baseInsert(fixtures.intentIds.A, { activa: true }));
      await repo.create(baseInsert(fixtures.intentIds.A, { activa: false }));
      await repo.create(baseInsert(fixtures.intentIds.B, { activa: true }));

      const r = await repo.listActiveByIntent(fixtures.intentIds.A);
      expect(r).toHaveLength(1);
      expect(r[0]?.intent_id).toBe(fixtures.intentIds.A);
      expect(r[0]?.activa).toBe(true);
    });

    test("listActiveByIntent orden prioridad DESC", async () => {
      const low = await repo.create(baseInsert(fixtures.intentIds.I, { prioridad: 10 }));
      const high = await repo.create(baseInsert(fixtures.intentIds.I, { prioridad: 100 }));
      const mid = await repo.create(baseInsert(fixtures.intentIds.I, { prioridad: 50 }));

      const r = await repo.listActiveByIntent(fixtures.intentIds.I);
      expect(r.map((x) => x.id)).toEqual([high.id, mid.id, low.id]);
    });

    test("listActiveByIntent tie-break created_at ASC con misma prioridad", async () => {
      const first = await repo.create(baseInsert(fixtures.intentIds.T, { prioridad: 50 }));
      await new Promise((res) => setTimeout(res, 5));
      const second = await repo.create(baseInsert(fixtures.intentIds.T, { prioridad: 50 }));

      const r = await repo.listActiveByIntent(fixtures.intentIds.T);
      expect(r.map((x) => x.id)).toEqual([first.id, second.id]);
    });

    test("listActiveByIntent devuelve [] cuando no hay reglas", async () => {
      expect(await repo.listActiveByIntent(fixtures.intentIds.empty)).toEqual([]);
    });

    test("list sin filter devuelve todas", async () => {
      await repo.create(baseInsert(fixtures.intentIds.X));
      await repo.create(baseInsert(fixtures.intentIds.Y, { activa: false }));
      const all = await repo.list();
      expect(all).toHaveLength(2);
    });

    test("list filtra por intentId", async () => {
      await repo.create(baseInsert(fixtures.intentIds.X));
      await repo.create(baseInsert(fixtures.intentIds.Y));
      await repo.create(baseInsert(fixtures.intentIds.X, { activa: false }));
      const r = await repo.list({ intentId: fixtures.intentIds.X });
      expect(r).toHaveLength(2);
      expect(r.every((x) => x.intent_id === fixtures.intentIds.X)).toBe(true);
    });

    test("list filtra por activa", async () => {
      await repo.create(baseInsert(fixtures.intentIds.base, { activa: true }));
      await repo.create(baseInsert(fixtures.intentIds.Z, { activa: false }));
      const activos = await repo.list({ activa: true });
      expect(activos).toHaveLength(1);
      const inactivos = await repo.list({ activa: false });
      expect(inactivos).toHaveLength(1);
    });

    test("condiciones_extra jsonb se clona defensivamente", async () => {
      const cond: Record<string, unknown> = { urgencia: "alta", nested: { key: "val" } };
      const r = await repo.create(baseInsert(fixtures.intentIds.base, { condiciones_extra: cond }));
      // Mutación del input no afecta storage.
      (cond as { urgencia: string }).urgencia = "mutado";
      const refetch = await repo.findById(r.id);
      expect((refetch?.condiciones_extra as { urgencia: string }).urgencia).toBe("alta");
    });
  });
}
