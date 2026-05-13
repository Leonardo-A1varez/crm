import { describe, expect, test } from "vitest";
import {
  InMemoryToolExecutionsRepository,
  NoopToolExecutionsRepository,
  type ToolExecutionInsert,
} from "@/server/repositories/tool-executions.repo";

function base(overrides: Partial<ToolExecutionInsert> = {}): ToolExecutionInsert {
  return {
    lead_session_id: "sess-1",
    mensaje_id: null,
    tool_name: "buscar_repuesto",
    args: { query: "pastilla" },
    result: { matches: [], count: 0 },
    error: null,
    duration_ms: 12,
    ...overrides,
  };
}

describe("InMemoryToolExecutionsRepository", () => {
  test("create asigna id + created_at + persiste args/result", async () => {
    const repo = new InMemoryToolExecutionsRepository();
    const t = await repo.create(base());
    expect(t.id).toBeTypeOf("string");
    expect(t.created_at).toBeInstanceOf(Date);
    expect(t.args).toEqual({ query: "pastilla" });
    expect(t.result).toEqual({ matches: [], count: 0 });
  });

  test("listBySession filtra por session + orden DESC", async () => {
    const repo = new InMemoryToolExecutionsRepository();
    const a = await repo.create(base({ lead_session_id: "s1" }));
    await new Promise((r) => setTimeout(r, 5));
    const b = await repo.create(base({ lead_session_id: "s1" }));
    await repo.create(base({ lead_session_id: "s2" }));

    const list = await repo.listBySession("s1");
    expect(list.map((t) => t.id)).toEqual([b.id, a.id]);
  });

  test("listBySession respeta limit", async () => {
    const repo = new InMemoryToolExecutionsRepository();
    for (let i = 0; i < 5; i++) {
      await repo.create(base({ lead_session_id: "s1" }));
      await new Promise((r) => setTimeout(r, 1));
    }
    const list = await repo.listBySession("s1", 2);
    expect(list).toHaveLength(2);
  });

  test("persistir error sin result", async () => {
    const repo = new InMemoryToolExecutionsRepository();
    const t = await repo.create(base({ result: null, error: "stock vacio" }));
    expect(t.result).toBeNull();
    expect(t.error).toBe("stock vacio");
  });

  test("args/result deep-clone defense (mutación externa no afecta storage)", async () => {
    const repo = new InMemoryToolExecutionsRepository();
    const args = { query: "orig" };
    const t = await repo.create(base({ args }));
    args.query = "mutado";

    const refetch = await repo.findById(t.id);
    expect((refetch!.args as { query: string }).query).toBe("orig");
  });
});

describe("NoopToolExecutionsRepository", () => {
  test("create retorna objeto sin persistir", async () => {
    const repo = new NoopToolExecutionsRepository();
    const t = await repo.create(base());
    expect(t.id).toBeTypeOf("string");
    expect(await repo.findById(t.id)).toBeNull();
    expect(await repo.listBySession("anything")).toEqual([]);
  });
});
