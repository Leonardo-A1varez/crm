import { describe, expect, test, beforeEach } from "vitest";
import type {
  ConversacionInsert,
  ConversationsRepository,
} from "@/server/repositories/conversations.repo";

function baseInsert(overrides: Partial<ConversacionInsert> = {}): ConversacionInsert {
  return {
    lead_id: "lead-1",
    canal: "wa",
    canal_thread_id: "wa_thread_001",
    ...overrides,
  };
}

export function runConversationsContract(makeRepo: () => ConversationsRepository) {
  describe("ConversationsRepository contract", () => {
    let repo: ConversationsRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    test("create asigna id + ultima_actividad_at", async () => {
      const c = await repo.create(baseInsert());
      expect(c.id).toBeTypeOf("string");
      expect(c.ultima_actividad_at).toBeInstanceOf(Date);
      expect(c.lead_id).toBe("lead-1");
      expect(c.canal).toBe("wa");
      expect(c.canal_thread_id).toBe("wa_thread_001");

      expect(await repo.findById(c.id)).toEqual(c);
    });

    test("create rechaza (canal, canal_thread_id) duplicado", async () => {
      await repo.create(baseInsert());
      await expect(repo.create(baseInsert())).rejects.toThrow(/canal_thread_id|duplicad/i);
    });

    test("create permite mismo canal_thread_id en canal distinto", async () => {
      await repo.create(baseInsert({ canal: "wa", canal_thread_id: "thread_X" }));
      const ig = await repo.create(baseInsert({ canal: "ig", canal_thread_id: "thread_X" }));
      expect(ig.canal).toBe("ig");
    });

    test("findByCanalThread localiza por par (canal, threadId)", async () => {
      const c = await repo.create(baseInsert());
      const found = await repo.findByCanalThread("wa", "wa_thread_001");
      expect(found?.id).toBe(c.id);
      expect(await repo.findByCanalThread("ig", "wa_thread_001")).toBeNull();
      expect(await repo.findByCanalThread("wa", "otro")).toBeNull();
    });

    test("findByLeadId devuelve conversaciones ordenadas por ultima_actividad_at DESC", async () => {
      const wa = await repo.create(baseInsert({ canal: "wa", canal_thread_id: "t1" }));
      await new Promise((r) => setTimeout(r, 5));
      const ig = await repo.create(baseInsert({ canal: "ig", canal_thread_id: "t2" }));
      await new Promise((r) => setTimeout(r, 5));
      await repo.touch(wa.id);

      const list = await repo.findByLeadId("lead-1");
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe(wa.id);
      expect(list[1].id).toBe(ig.id);
    });

    test("findByLeadId devuelve [] cuando lead no tiene conversaciones", async () => {
      expect(await repo.findByLeadId("lead-vacio")).toEqual([]);
    });

    test("upsertByCanalThread crea cuando no existe", async () => {
      const c = await repo.upsertByCanalThread("wa", "thread_new", "lead-1");
      expect(c.lead_id).toBe("lead-1");
      expect(c.canal_thread_id).toBe("thread_new");
      const again = await repo.findByCanalThread("wa", "thread_new");
      expect(again?.id).toBe(c.id);
    });

    test("upsertByCanalThread devuelve existente con mismo lead sin duplicar", async () => {
      const first = await repo.upsertByCanalThread("wa", "thread_x", "lead-1");
      const second = await repo.upsertByCanalThread("wa", "thread_x", "lead-1");
      expect(second.id).toBe(first.id);
      expect(await repo.findByLeadId("lead-1")).toHaveLength(1);
    });

    test("upsertByCanalThread throws si (canal, threadId) pertenece a otro lead", async () => {
      await repo.upsertByCanalThread("wa", "thread_z", "lead-A");
      await expect(repo.upsertByCanalThread("wa", "thread_z", "lead-B")).rejects.toThrow(/lead/i);
    });

    test("touch sin `at` setea ultima_actividad_at a now", async () => {
      const c = await repo.create(baseInsert());
      const before = c.ultima_actividad_at.getTime();
      await new Promise((r) => setTimeout(r, 5));
      const touched = await repo.touch(c.id);
      expect(touched.ultima_actividad_at.getTime()).toBeGreaterThan(before);
    });

    test("touch con `at` explícita usa ese valor", async () => {
      const c = await repo.create(baseInsert());
      const target = new Date("2026-01-01T00:00:00Z");
      const touched = await repo.touch(c.id, target);
      expect(touched.ultima_actividad_at.getTime()).toBe(target.getTime());
    });

    test("touch throws cuando id falta", async () => {
      await expect(repo.touch("missing")).rejects.toThrow();
    });

    test("update permite reasignar lead_id (merge) pero no canal/canal_thread_id", async () => {
      const c = await repo.create(baseInsert());
      const moved = await repo.update(c.id, { lead_id: "lead-NEW" });
      expect(moved.lead_id).toBe("lead-NEW");
      expect(moved.canal).toBe(c.canal);
      expect(moved.canal_thread_id).toBe(c.canal_thread_id);
    });

    test("update throws cuando id falta", async () => {
      await expect(repo.update("missing", { lead_id: "x" })).rejects.toThrow();
    });
  });
}
