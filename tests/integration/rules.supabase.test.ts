import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseRulesRepository } from "@/server/repositories/rules.supabase.repo";
import type { RulesContractFixtures } from "../repositories/rules.contract";
import { runRulesContract } from "../repositories/rules.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;
let fixtures: RulesContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Cleanup reglas-only — preserva fixture intents.
  const { error } = await client
    .from("reglas")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup reglas fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseRulesRepository (integration)", () => {
  runRulesContract(
    () => new SupabaseRulesRepository(client),
    () => fixtures,
  );
});

/**
 * Seed 9 intents fixtures con UUIDs estables (uno por nombre lógico del contract).
 * Los intents persisten across tests — beforeEach solo limpia reglas (cascade no
 * aplica desde reglas hacia intents).
 */
async function seedFixtures(c: TestClient): Promise<RulesContractFixtures> {
  const intentIds = {
    base: crypto.randomUUID(),
    A: crypto.randomUUID(),
    B: crypto.randomUUID(),
    I: crypto.randomUUID(),
    T: crypto.randomUUID(),
    X: crypto.randomUUID(),
    Y: crypto.randomUUID(),
    Z: crypto.randomUUID(),
    empty: crypto.randomUUID(),
  };

  const rows = (Object.entries(intentIds) as [keyof typeof intentIds, string][]).map(
    ([key, id]) => ({
      id,
      // nombre UNIQUE; deriva del UUID para evitar colisión entre runs
      // si la cleanup falla parcialmente.
      nombre: `rules-fix-${key}-${id.slice(0, 8)}`,
      descripcion: "fixture rules contract",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    }),
  );
  const { error } = await c.from("intents").insert(rows);
  if (error) throw new Error(`seed intents: ${error.message}`);

  return { intentIds };
}
