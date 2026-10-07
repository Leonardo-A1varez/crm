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
    expect(await repo.listByMensajeIds("anything", ["m1"])).toEqual([]);
  });
});

describe("InMemoryToolExecutionsRepository.listByMensajeIds", () => {
  test("solo las llamadas de esos mensajes y de esa sesión, en orden cronológico", async () => {
    const repo = new InMemoryToolExecutionsRepository();
    const a = await repo.create(base({ mensaje_id: "m1" }));
    await new Promise((r) => setTimeout(r, 3));
    const b = await repo.create(base({ mensaje_id: "m2" }));
    await repo.create(base({ mensaje_id: null }));
    await repo.create(base({ mensaje_id: "m3" }));
    await repo.create(base({ lead_session_id: "otra", mensaje_id: "m1" }));

    const lista = await repo.listByMensajeIds("sess-1", ["m2", "m1"]);
    expect(lista.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(await repo.listByMensajeIds("sess-1", [])).toEqual([]);
  });
});
