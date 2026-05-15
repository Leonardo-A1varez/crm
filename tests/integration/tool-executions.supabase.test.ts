import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseToolExecutionsRepository } from "@/server/repositories/tool-executions.supabase.repo";
import type { ToolExecutionsContractFixtures } from "../repositories/tool-executions.contract";
import { runToolExecutionsContract } from "../repositories/tool-executions.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;
let fixtures: ToolExecutionsContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Cleanup tool_executions-only — preserva fixture lead/lead_sessions.
  const { error } = await client
    .from("tool_executions")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup tool_executions fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseToolExecutionsRepository (integration)", () => {
  runToolExecutionsContract(
    () => new SupabaseToolExecutionsRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<ToolExecutionsContractFixtures> {
  // 1 lead parent + 3 lead_sessions (uno por logical name del contract).
  // lead_session_unique_activa_idx exige máx 1 sesión activa per lead — usamos
  // 3 leads distintos, 1 sesión por cada (resultado IS NULL = activa).
  const leadIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const leadSessionIds = {
    sess1: crypto.randomUUID(),
    s1: crypto.randomUUID(),
    s2: crypto.randomUUID(),
  };

  const leadsRows = leadIds.map((id, i) => ({
    id,
    nombre: `ToolExec Fixture Lead ${i}`,
    telefono: `+5${id.replace(/-/g, "").slice(0, 12)}`,
    vehiculo_marca: "Toyota",
    vehiculo_modelo: "Corolla",
    vehiculo_anio: 2020,
    canal_origen: "wa" as const,
    meta_user_ids: {},
  }));
  const { error: leadErr } = await c.from("leads").insert(leadsRows);
  if (leadErr) throw new Error(`seed leads: ${leadErr.message}`);

  const sessRows = (Object.entries(leadSessionIds) as [keyof typeof leadSessionIds, string][]).map(
    ([key, id], i) => ({
      id,
      // Asocia cada sesión a un lead distinto para no violar partial unique.
      lead_id: leadIds[i] as string,
      consulta: `tool-exec fixture ${key}`,
    }),
  );
  const { error: sessErr } = await c.from("lead_session").insert(sessRows);
  if (sessErr) throw new Error(`seed lead_session: ${sessErr.message}`);

  return { leadSessionIds };
}
