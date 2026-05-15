import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import type { ConversationsContractFixtures } from "../repositories/conversations.contract";
import { runConversationsContract } from "../repositories/conversations.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;
let fixtures: ConversationsContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Cleanup conversaciones-only — preserva fixture leads.
  const { error } = await client
    .from("conversaciones")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup conversaciones fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseConversationsRepository (integration)", () => {
  runConversationsContract(
    () => new SupabaseConversationsRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<ConversationsContractFixtures> {
  const leadIds = {
    one: crypto.randomUUID(),
    A: crypto.randomUUID(),
    B: crypto.randomUUID(),
    NEW: crypto.randomUUID(),
    empty: crypto.randomUUID(),
  };

  const leadsRows = (Object.entries(leadIds) as [keyof typeof leadIds, string][]).map(
    ([key, id]) => ({
      id,
      nombre: `Conv Fixture ${key}`,
      telefono: `+8${id.replace(/-/g, "").slice(0, 12)}`,
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
