import { describe, expect, test } from "vitest";
import {
  InMemoryToolExecutionsRepository,
  NoopToolExecutionsRepository,
  type ToolExecutionInsert,
} from "@/server/repositories/tool-executions.repo";
import { runToolExecutionsContract } from "../repositories/tool-executions.contract";

runToolExecutionsContract(() => new InMemoryToolExecutionsRepository());

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

describe("NoopToolExecutionsRepository", () => {
  test("create retorna objeto sin persistir", async () => {
    const repo = new NoopToolExecutionsRepository();
    const t = await repo.create(base());
    expect(t.id).toBeTypeOf("string");
    expect(await repo.findById(t.id)).toBeNull();
    expect(await repo.listBySession("anything")).toEqual([]);
  });
});
