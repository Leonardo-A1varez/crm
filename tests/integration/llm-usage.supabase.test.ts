import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseLlmUsageRepository } from "@/server/repositories/llm-usage.supabase.repo";
import { sembrarCadena, sembrarMensaje } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { LlmUsageContractFixtures } from "../repositories/llm-usage.contract";
import { runLlmUsageContract } from "../repositories/llm-usage.contract";

let client: TestClient;
let fixtures: LlmUsageContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  const { error } = await client
    .from("llm_usage")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup llm_usage fail: ${error.message}`);
});

afterAll(async () => {
  await client.from("llm_usage").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await cleanupTestDb(client);
});

describe("SupabaseLlmUsageRepository (integration)", () => {
  runLlmUsageContract(
    () => new SupabaseLlmUsageRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<LlmUsageContractFixtures> {
  // Dos sesiones = dos leads: `lead_session_unique_activa_idx` admite una sola
  // sesión activa por lead.
  const a = await sembrarCadena(c, "llm-usage-a");
  const b = await sembrarCadena(c, "llm-usage-b");
  const m2 = await sembrarMensaje(c, a.conversacionId, a.sesionId, "segundo");
  return {
    leadSessionIds: { s1: a.sesionId, s2: b.sesionId },
    mensajeIds: { m1: a.mensajeId, m2 },
  };
}
