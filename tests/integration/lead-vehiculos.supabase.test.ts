import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.supabase.repo";
import { sembrarLead } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { LeadVehiculosContractFixtures } from "../repositories/lead-vehiculos.contract";
import { runLeadVehiculosContract } from "../repositories/lead-vehiculos.contract";

let client: TestClient;
let fixtures: LeadVehiculosContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  const { error } = await client
    .from("lead_vehiculos")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup lead_vehiculos fail: ${error.message}`);
});

afterAll(async () => {
  await client.from("lead_vehiculos").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await cleanupTestDb(client);
});

describe("SupabaseLeadVehiculosRepository (integration)", () => {
  runLeadVehiculosContract(
    () => new SupabaseLeadVehiculosRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<LeadVehiculosContractFixtures> {
  const [a, b] = await Promise.all([sembrarLead(c, "vehic-a"), sembrarLead(c, "vehic-b")]);
  return { leadIds: { a, b }, desconocido: crypto.randomUUID() };
}
