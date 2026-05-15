import { describe, expect, test, beforeEach } from "vitest";
import type {
  ToolExecutionInsert,
  ToolExecutionsRepository,
} from "@/server/repositories/tool-executions.repo";
import type { UUID } from "@/types/entities";

export interface ToolExecutionsContractFixtures {
  leadSessionIds: { sess1: UUID; s1: UUID; s2: UUID };
}

const DEFAULT_FIXTURES: ToolExecutionsContractFixtures = {
  leadSessionIds: { sess1: "sess-1", s1: "s1", s2: "s2" },
};

export type ToolExecutionsContractFixturesArg =
  | ToolExecutionsContractFixtures
  | (() => ToolExecutionsContractFixtures);

function base(
  fixtures: ToolExecutionsContractFixtures,
  overrides: Partial<ToolExecutionInsert> = {},
): ToolExecutionInsert {
  return {
    lead_session_id: fixtures.leadSessionIds.sess1,
    mensaje_id: null,
    tool_name: "buscar_repuesto",
    args: { query: "pastilla" },
    result: { matches: [], count: 0 },
    error: null,
    duration_ms: 12,
    ...overrides,
  };
}

export function runToolExecutionsContract(
  makeRepo: () => ToolExecutionsRepository,
  fixturesArg: ToolExecutionsContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("ToolExecutionsRepository contract", () => {
    let repo: ToolExecutionsRepository;
    let fixtures: ToolExecutionsContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create asigna id + created_at + persiste args/result", async () => {
      const t = await repo.create(base(fixtures));
      expect(t.id).toBeTypeOf("string");
      expect(t.created_at).toBeInstanceOf(Date);
      expect(t.args).toEqual({ query: "pastilla" });
      expect(t.result).toEqual({ matches: [], count: 0 });
    });

    test("listBySession filtra por session + orden DESC", async () => {
      const a = await repo.create(base(fixtures, { lead_session_id: fixtures.leadSessionIds.s1 }));
      await new Promise((r) => setTimeout(r, 5));
      const b = await repo.create(base(fixtures, { lead_session_id: fixtures.leadSessionIds.s1 }));
      await repo.create(base(fixtures, { lead_session_id: fixtures.leadSessionIds.s2 }));

      const list = await repo.listBySession(fixtures.leadSessionIds.s1);
      expect(list.map((t) => t.id)).toEqual([b.id, a.id]);
    });

    test("listBySession respeta limit", async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create(base(fixtures, { lead_session_id: fixtures.leadSessionIds.s1 }));
        await new Promise((r) => setTimeout(r, 1));
      }
      const list = await repo.listBySession(fixtures.leadSessionIds.s1, 2);
      expect(list).toHaveLength(2);
    });

    test("persistir error sin result", async () => {
      const t = await repo.create(base(fixtures, { result: null, error: "stock vacio" }));
      expect(t.result).toBeNull();
      expect(t.error).toBe("stock vacio");
    });

    test("args/result deep-clone defense (mutación externa no afecta storage)", async () => {
      const args = { query: "orig" };
      const t = await repo.create(base(fixtures, { args }));
      args.query = "mutado";

      const refetch = await repo.findById(t.id);
      expect((refetch?.args as { query: string }).query).toBe("orig");
    });
  });
}
