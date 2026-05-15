import { beforeEach, describe, expect, test } from "vitest";
import type {
  ReactivationDispatchInsert,
  ReactivationDispatchesRepository,
} from "@/server/repositories/reactivation-dispatches.repo";
import type { UUID } from "@/types/entities";

export interface ReactivationDispatchesContractFixtures {
  leadSessionIds: {
    session1: UUID;
    sessionX: UUID;
    sA: UUID;
    sB: UUID;
    sList: UUID;
    other: UUID;
  };
}

const DEFAULT_FIXTURES: ReactivationDispatchesContractFixtures = {
  leadSessionIds: {
    session1: "session-1",
    sessionX: "session-X",
    sA: "sA",
    sB: "sB",
    sList: "sList",
    other: "other",
  },
};

export type ReactivationDispatchesContractFixturesArg =
  | ReactivationDispatchesContractFixtures
  | (() => ReactivationDispatchesContractFixtures);

function baseInsert(
  fixtures: ReactivationDispatchesContractFixtures,
  overrides: Partial<ReactivationDispatchInsert> = {},
): ReactivationDispatchInsert {
  return {
    lead_session_id: fixtures.leadSessionIds.session1,
    motivo: "precio",
    template_name: "reactivacion_precio_v1",
    meta_message_id: null,
    ...overrides,
  };
}

export function runReactivationDispatchesContract(
  makeRepo: () => ReactivationDispatchesRepository,
  fixturesArg: ReactivationDispatchesContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("ReactivationDispatchesRepository contract", () => {
    let repo: ReactivationDispatchesRepository;
    let fixtures: ReactivationDispatchesContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create asigna id + created_at + persiste con status default 'sent'", async () => {
      const r = await repo.create(baseInsert(fixtures));
      expect(r.id).toBeTypeOf("string");
      expect(r.created_at).toBeInstanceOf(Date);
      expect(r.status).toBe("sent");
      expect(r.motivo).toBe("precio");
      expect(r.template_name).toBe("reactivacion_precio_v1");

      const found = await repo.findById(r.id);
      expect(found).toEqual(r);
    });

    test("create acepta status override (failed/bounced)", async () => {
      const r = await repo.create(baseInsert(fixtures, { status: "failed" }));
      expect(r.status).toBe("failed");
    });

    test("findLatestBySessionId null cuando sin dispatches", async () => {
      expect(await repo.findLatestBySessionId(fixtures.leadSessionIds.sessionX)).toBeNull();
    });

    test("findLatestBySessionId retorna el más reciente", async () => {
      await repo.create(
        baseInsert(fixtures, {
          lead_session_id: fixtures.leadSessionIds.sA,
          template_name: "t1",
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
      const second = await repo.create(
        baseInsert(fixtures, {
          lead_session_id: fixtures.leadSessionIds.sA,
          template_name: "t2",
        }),
      );

      const latest = await repo.findLatestBySessionId(fixtures.leadSessionIds.sA);
      expect(latest?.id).toBe(second.id);
      expect(latest?.template_name).toBe("t2");
    });

    test("findLatestBySessionId aisla por session", async () => {
      const a = await repo.create(
        baseInsert(fixtures, { lead_session_id: fixtures.leadSessionIds.sA }),
      );
      await repo.create(baseInsert(fixtures, { lead_session_id: fixtures.leadSessionIds.sB }));

      const latestA = await repo.findLatestBySessionId(fixtures.leadSessionIds.sA);
      expect(latestA?.id).toBe(a.id);
    });

    test("listBySessionId orden DESC por created_at + filtra session + limit", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await repo.create(
          baseInsert(fixtures, {
            lead_session_id: fixtures.leadSessionIds.sList,
            template_name: `t_${i}`,
          }),
        );
        ids.push(r.id);
        await new Promise((r) => setTimeout(r, 2));
      }
      await repo.create(baseInsert(fixtures, { lead_session_id: fixtures.leadSessionIds.other }));

      const list = await repo.listBySessionId(fixtures.leadSessionIds.sList);
      expect(list).toHaveLength(5);
      expect(list[0]?.id).toBe(ids[ids.length - 1]); // DESC
      expect(list.every((r) => r.lead_session_id === fixtures.leadSessionIds.sList)).toBe(true);

      const limited = await repo.listBySessionId(fixtures.leadSessionIds.sList, 2);
      expect(limited).toHaveLength(2);
    });

    test("create deep-copia row retornado (defense vs caller mutation)", async () => {
      const r = await repo.create(baseInsert(fixtures));
      r.template_name = "MUTADO";

      const refetch = await repo.findById(r.id);
      expect(refetch?.template_name).toBe("reactivacion_precio_v1");
    });

    test("motivo null permitido (cuando sesión perdida sin motivo registrado)", async () => {
      const r = await repo.create(baseInsert(fixtures, { motivo: null }));
      expect(r.motivo).toBeNull();
    });
  });
}
