import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SupabaseToolExecutionsRepository } from "@/server/repositories/tool-executions.supabase.repo";
import { sembrarCadena } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

// `listByMensajeIds` contra Postgres real: lo que lee el auto-handoff para saber
// si un turno previo sin intent fue atendido con una búsqueda con resultados.

let client: TestClient;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseToolExecutionsRepository.listByMensajeIds (integration)", () => {
  test("devuelve solo las llamadas de esos mensajes y de esa sesión, en orden cronológico", async () => {
    const repo = new SupabaseToolExecutionsRepository(client);
    const a = await sembrarCadena(client, "tool-por-mensaje-a");
    const b = await sembrarCadena(client, "tool-por-mensaje-b");

    const base = { args: { query: "bomba" }, error: null, duration_ms: 3 };
    const conResultados = await repo.create({
      ...base,
      lead_session_id: a.sesionId,
      mensaje_id: a.mensajeId,
      tool_name: "buscar_repuesto",
      result: { matches: [{ id: "x" }], count: 1 },
    });
    await new Promise((r) => setTimeout(r, 5));
    const otraDeLaMismaSesion = await repo.create({
      ...base,
      lead_session_id: a.sesionId,
      mensaje_id: a.mensajeId,
      tool_name: "buscar_repuesto",
      result: { matches: [], count: 0 },
    });
    // Sin ancla (filas viejas): no aparece.
    await repo.create({
      ...base,
      lead_session_id: a.sesionId,
      mensaje_id: null,
      tool_name: "buscar_repuesto",
      result: { matches: [], count: 0 },
    });
    // Otra sesión: no aparece aunque se pida su mensaje con la sesión equivocada.
    await repo.create({
      ...base,
      lead_session_id: b.sesionId,
      mensaje_id: b.mensajeId,
      tool_name: "buscar_repuesto",
      result: { matches: [], count: 0 },
    });

    const lista = await repo.listByMensajeIds(a.sesionId, [a.mensajeId, b.mensajeId]);
    expect(lista.map((t) => t.id)).toEqual([conResultados.id, otraDeLaMismaSesion.id]);
    expect(lista[0]?.mensaje_id).toBe(a.mensajeId);
    expect(lista[0]?.result).toEqual({ matches: [{ id: "x" }], count: 1 });
  });

  test("sin ids, con ids que no son UUID o de una sesión sin llamadas devuelve vacío", async () => {
    const repo = new SupabaseToolExecutionsRepository(client);
    const c = await sembrarCadena(client, "tool-por-mensaje-c");
    expect(await repo.listByMensajeIds(c.sesionId, [])).toEqual([]);
    expect(await repo.listByMensajeIds(c.sesionId, ["no-es-uuid"])).toEqual([]);
    expect(await repo.listByMensajeIds(c.sesionId, [c.mensajeId])).toEqual([]);
    expect(await repo.listByMensajeIds("no-es-uuid", [c.mensajeId])).toEqual([]);
  });
});
