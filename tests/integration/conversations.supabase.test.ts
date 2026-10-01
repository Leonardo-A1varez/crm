import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
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

describe("modo_respuesta_override (solo Postgres)", () => {
  test("el CHECK de la base rechaza un modo fuera del dominio (23514)", async () => {
    const { data, error } = await client
      .from("conversaciones")
      .insert({
        lead_id: fixtures.leadIds.one,
        canal: "wa",
        canal_thread_id: "check-modo-1",
        modo_respuesta_override: "otro" as never,
      })
      .select();

    expect(data).toBeNull();
    expect(error?.code).toBe("23514");
  });
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
