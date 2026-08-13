import { describe, expect, test, beforeEach } from "vitest";
import type {
  ConversacionInsert,
  ConversationsRepository,
} from "@/server/repositories/conversations.repo";
import type { UUID } from "@/types/entities";

export interface ConversationsContractFixtures {
  leadIds: {
    one: UUID;
    A: UUID;
    B: UUID;
    NEW: UUID;
    empty: UUID;
  };
}

const DEFAULT_FIXTURES: ConversationsContractFixtures = {
  leadIds: {
    one: "lead-1",
    A: "lead-A",
    B: "lead-B",
    NEW: "lead-NEW",
    empty: "lead-vacio",
  },
};

export type ConversationsContractFixturesArg =
  | ConversationsContractFixtures
  | (() => ConversationsContractFixtures);

function baseInsert(leadId: UUID, overrides: Partial<ConversacionInsert> = {}): ConversacionInsert {
  return {
    lead_id: leadId,
    canal: "wa",
    canal_thread_id: "wa_thread_001",
    ...overrides,
  };
}

export function runConversationsContract(
  makeRepo: () => ConversationsRepository,
  fixturesArg: ConversationsContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("ConversationsRepository contract", () => {
    let repo: ConversationsRepository;
    let fixtures: ConversationsContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create asigna id + ultima_actividad_at", async () => {
      const c = await repo.create(baseInsert(fixtures.leadIds.one));
      expect(c.id).toBeTypeOf("string");
      expect(c.ultima_actividad_at).toBeInstanceOf(Date);
      expect(c.lead_id).toBe(fixtures.leadIds.one);
      expect(c.canal).toBe("wa");
      expect(c.canal_thread_id).toBe("wa_thread_001");

      expect(await repo.findById(c.id)).toEqual(c);
    });

    test("create rechaza (canal, canal_thread_id) duplicado", async () => {
      await repo.create(baseInsert(fixtures.leadIds.one));
      await expect(repo.create(baseInsert(fixtures.leadIds.one))).rejects.toThrow(
        /canal_thread_id|duplicad/i,
      );
    });

    test("create permite mismo canal_thread_id en canal distinto", async () => {
      await repo.create(
        baseInsert(fixtures.leadIds.one, { canal: "wa", canal_thread_id: "thread_X" }),
      );
      const ig = await repo.create(
        baseInsert(fixtures.leadIds.one, { canal: "ig", canal_thread_id: "thread_X" }),
      );
      expect(ig.canal).toBe("ig");
    });

    test("findByCanalThread localiza por par (canal, threadId)", async () => {
      const c = await repo.create(baseInsert(fixtures.leadIds.one));
      const found = await repo.findByCanalThread("wa", "wa_thread_001");
      expect(found?.id).toBe(c.id);
      expect(await repo.findByCanalThread("ig", "wa_thread_001")).toBeNull();
      expect(await repo.findByCanalThread("wa", "otro")).toBeNull();
    });

    test("findByLeadId devuelve conversaciones ordenadas por ultima_actividad_at DESC", async () => {
      const wa = await repo.create(
        baseInsert(fixtures.leadIds.one, { canal: "wa", canal_thread_id: "t1" }),
      );
      await new Promise((r) => setTimeout(r, 5));
      const ig = await repo.create(
        baseInsert(fixtures.leadIds.one, { canal: "ig", canal_thread_id: "t2" }),
      );
      await new Promise((r) => setTimeout(r, 5));
      await repo.touch(wa.id);

      const list = await repo.findByLeadId(fixtures.leadIds.one);
      expect(list).toHaveLength(2);
      expect(list[0]?.id).toBe(wa.id);
      expect(list[1]?.id).toBe(ig.id);
    });

    test("findByLeadId devuelve [] cuando lead no tiene conversaciones", async () => {
      expect(await repo.findByLeadId(fixtures.leadIds.empty)).toEqual([]);
    });

    test("listByLeadIds trae los hilos de varios leads en un solo orden DESC", async () => {
      const viejaA = await repo.create(
        baseInsert(fixtures.leadIds.A, { canal: "wa", canal_thread_id: "lote-a1" }),
      );
      await new Promise((r) => setTimeout(r, 5));
      const deB = await repo.create(
        baseInsert(fixtures.leadIds.B, { canal: "wa", canal_thread_id: "lote-b1" }),
      );
      await new Promise((r) => setTimeout(r, 5));
      const nuevaA = await repo.create(
        baseInsert(fixtures.leadIds.A, { canal: "ig", canal_thread_id: "lote-a2" }),
      );
      // De otro lead que no se pide: no puede colarse.
      await repo.create(baseInsert(fixtures.leadIds.one, { canal_thread_id: "lote-otro" }));

      const list = await repo.listByLeadIds([fixtures.leadIds.A, fixtures.leadIds.B]);

      expect(list.map((c) => c.id)).toEqual([nuevaA.id, deB.id, viejaA.id]);
      // Agrupar por lead conservando ese orden deja cada grupo como lo devuelve
      // `findByLeadId`: es de lo que depende la bandeja para elegir el hilo
      // activo sin una consulta por fila.
      expect(list.filter((c) => c.lead_id === fixtures.leadIds.A).map((c) => c.id)).toEqual([
        nuevaA.id,
        viejaA.id,
      ]);
    });

    test("listByLeadIds sin ids no consulta y devuelve vacío", async () => {
      await repo.create(baseInsert(fixtures.leadIds.one, { canal_thread_id: "lote-vacio" }));
      expect(await repo.listByLeadIds([])).toEqual([]);
    });

    test("upsertByCanalThread crea cuando no existe", async () => {
      const c = await repo.upsertByCanalThread("wa", "thread_new", fixtures.leadIds.one);
      expect(c.lead_id).toBe(fixtures.leadIds.one);
      expect(c.canal_thread_id).toBe("thread_new");
      const again = await repo.findByCanalThread("wa", "thread_new");
      expect(again?.id).toBe(c.id);
    });

    test("upsertByCanalThread devuelve existente con mismo lead sin duplicar", async () => {
      const first = await repo.upsertByCanalThread("wa", "thread_x", fixtures.leadIds.one);
      const second = await repo.upsertByCanalThread("wa", "thread_x", fixtures.leadIds.one);
      expect(second.id).toBe(first.id);
      expect(await repo.findByLeadId(fixtures.leadIds.one)).toHaveLength(1);
    });

    test("upsertByCanalThread throws si (canal, threadId) pertenece a otro lead", async () => {
      await repo.upsertByCanalThread("wa", "thread_z", fixtures.leadIds.A);
      await expect(repo.upsertByCanalThread("wa", "thread_z", fixtures.leadIds.B)).rejects.toThrow(
        /lead/i,
      );
    });

    test("touch sin `at` setea ultima_actividad_at a now", async () => {
      const c = await repo.create(baseInsert(fixtures.leadIds.one));
      const before = c.ultima_actividad_at.getTime();
      await new Promise((r) => setTimeout(r, 5));
      const touched = await repo.touch(c.id);
      expect(touched.ultima_actividad_at.getTime()).toBeGreaterThan(before);
    });

    test("touch con `at` explícita usa ese valor", async () => {
      const c = await repo.create(baseInsert(fixtures.leadIds.one));
      const target = new Date("2026-01-01T00:00:00Z");
      const touched = await repo.touch(c.id, target);
      expect(touched.ultima_actividad_at.getTime()).toBe(target.getTime());
    });

    test("touch throws cuando id falta", async () => {
      await expect(repo.touch("missing")).rejects.toThrow();
    });

    test("update permite reasignar lead_id (merge) pero no canal/canal_thread_id", async () => {
      const c = await repo.create(baseInsert(fixtures.leadIds.one));
      const moved = await repo.update(c.id, { lead_id: fixtures.leadIds.NEW });
      expect(moved.lead_id).toBe(fixtures.leadIds.NEW);
      expect(moved.canal).toBe(c.canal);
      expect(moved.canal_thread_id).toBe(c.canal_thread_id);
    });

    test("update throws cuando id falta", async () => {
      await expect(repo.update("missing", { lead_id: fixtures.leadIds.one })).rejects.toThrow();
    });
  });
}
