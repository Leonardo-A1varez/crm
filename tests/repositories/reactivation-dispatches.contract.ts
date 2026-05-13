import { beforeEach, describe, expect, test } from "vitest";
import type {
  ReactivationDispatchInsert,
  ReactivationDispatchesRepository,
} from "@/server/repositories/reactivation-dispatches.repo";

function baseInsert(
  overrides: Partial<ReactivationDispatchInsert> = {},
): ReactivationDispatchInsert {
  return {
    lead_session_id: "session-1",
    motivo: "precio",
    template_name: "reactivacion_precio_v1",
    meta_message_id: null,
    ...overrides,
  };
}

export function runReactivationDispatchesContract(
  makeRepo: () => ReactivationDispatchesRepository,
) {
  describe("ReactivationDispatchesRepository contract", () => {
    let repo: ReactivationDispatchesRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    test("create asigna id + created_at + persiste con status default 'sent'", async () => {
      const r = await repo.create(baseInsert());
      expect(r.id).toBeTypeOf("string");
      expect(r.created_at).toBeInstanceOf(Date);
      expect(r.status).toBe("sent");
      expect(r.motivo).toBe("precio");
      expect(r.template_name).toBe("reactivacion_precio_v1");

      const found = await repo.findById(r.id);
      expect(found).toEqual(r);
    });

    test("create acepta status override (failed/bounced)", async () => {
      const r = await repo.create(baseInsert({ status: "failed" }));
      expect(r.status).toBe("failed");
    });

    test("findLatestBySessionId null cuando sin dispatches", async () => {
      expect(await repo.findLatestBySessionId("session-X")).toBeNull();
    });

    test("findLatestBySessionId retorna el más reciente", async () => {
      await repo.create(baseInsert({ lead_session_id: "sA", template_name: "t1" }));
      await new Promise((r) => setTimeout(r, 5));
      const second = await repo.create(baseInsert({ lead_session_id: "sA", template_name: "t2" }));

      const latest = await repo.findLatestBySessionId("sA");
      expect(latest?.id).toBe(second.id);
      expect(latest?.template_name).toBe("t2");
    });

    test("findLatestBySessionId aisla por session", async () => {
      const a = await repo.create(baseInsert({ lead_session_id: "sA" }));
      await repo.create(baseInsert({ lead_session_id: "sB" }));

      const latestA = await repo.findLatestBySessionId("sA");
      expect(latestA?.id).toBe(a.id);
    });

    test("listBySessionId orden DESC por created_at + filtra session + limit", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await repo.create(
          baseInsert({ lead_session_id: "sList", template_name: `t_${i}` }),
        );
        ids.push(r.id);
        await new Promise((r) => setTimeout(r, 2));
      }
      await repo.create(baseInsert({ lead_session_id: "other" }));

      const list = await repo.listBySessionId("sList");
      expect(list).toHaveLength(5);
      expect(list[0].id).toBe(ids[ids.length - 1]); // DESC
      expect(list.every((r) => r.lead_session_id === "sList")).toBe(true);

      const limited = await repo.listBySessionId("sList", 2);
      expect(limited).toHaveLength(2);
    });

    test("create deep-copia row retornado (defense vs caller mutation)", async () => {
      const r = await repo.create(baseInsert());
      r.template_name = "MUTADO";

      const refetch = await repo.findById(r.id);
      expect(refetch?.template_name).toBe("reactivacion_precio_v1");
    });

    test("motivo null permitido (cuando sesión perdida sin motivo registrado)", async () => {
      const r = await repo.create(baseInsert({ motivo: null }));
      expect(r.motivo).toBeNull();
    });
  });
}
