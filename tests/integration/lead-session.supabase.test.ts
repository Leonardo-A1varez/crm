import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import type { LeadSessionContractFixtures } from "../repositories/lead-session.contract";
import { runLeadSessionContract } from "../repositories/lead-session.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;
let fixtures: LeadSessionContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Cleanup lead_session-only — preserva fixture leads.
  const { error } = await client
    .from("lead_session")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup lead_session fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseLeadSessionRepository (integration)", () => {
  runLeadSessionContract(
    () => new SupabaseLeadSessionRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<LeadSessionContractFixtures> {
  const leadIds = {
    one: crypto.randomUUID(),
    X: crypto.randomUUID(),
    Y: crypto.randomUUID(),
    A: crypto.randomUUID(),
    two: crypto.randomUUID(),
    three: crypto.randomUUID(),
    none: crypto.randomUUID(),
  };

  const leadsRows = (Object.entries(leadIds) as [keyof typeof leadIds, string][]).map(
    ([key, id]) => ({
      id,
      nombre: `LeadSession Fixture ${key}`,
      telefono: `+6${id.replace(/-/g, "").slice(0, 12)}`,
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2020,
      canal_origen: "wa" as const,
      meta_user_ids: {},
    }),
  );
  const { error } = await c.from("leads").insert(leadsRows);
  if (error) throw new Error(`seed leads: ${error.message}`);

  return { leadIds };
}
