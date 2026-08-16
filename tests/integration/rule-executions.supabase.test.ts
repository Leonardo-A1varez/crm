import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseRuleExecutionsRepository } from "@/server/repositories/rule-executions.supabase.repo";
import { sembrarCadena, sembrarIntent, sembrarMensaje, sembrarRegla } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { RuleExecutionsContractFixtures } from "../repositories/rule-executions.contract";
import { runRuleExecutionsContract } from "../repositories/rule-executions.contract";

let client: TestClient;
let fixtures: RuleExecutionsContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Solo los disparos: reglas, intent y mensajes son fixture y sobreviven.
  const { error } = await client
    .from("rule_executions")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup rule_executions fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseRuleExecutionsRepository (integration)", () => {
  runRuleExecutionsContract(
    () => new SupabaseRuleExecutionsRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<RuleExecutionsContractFixtures> {
  const { conversacionId, sesionId, mensajeId } = await sembrarCadena(c, "rule-exec");
  const m2 = await sembrarMensaje(c, conversacionId, sesionId, "segundo mensaje");
  const intentId = await sembrarIntent(c, "consulta_stock");
  const r1 = await sembrarRegla(c, intentId);
  const r2 = await sembrarRegla(c, intentId);
  return { reglaIds: { r1, r2 }, mensajeIds: { m1: mensajeId, m2 }, intentId };
}
