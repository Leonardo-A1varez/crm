import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseMergeCandidatesRepository } from "@/server/repositories/merge-candidates.supabase.repo";
import type { MergeCandidatesContractFixtures } from "../repositories/merge-candidates.contract";
import { runMergeCandidatesContract } from "../repositories/merge-candidates.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;
let fixtures: MergeCandidatesContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Cleanup merge_candidates-only — preserva fixture leads/usuarios.
  const { error } = await client
    .from("merge_candidates")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup merge_candidates fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseMergeCandidatesRepository (integration)", () => {
  runMergeCandidatesContract(
    () => new SupabaseMergeCandidatesRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<MergeCandidatesContractFixtures> {
  const leadIds = {
    a: crypto.randomUUID(),
    b: crypto.randomUUID(),
    x: crypto.randomUUID(),
    one: crypto.randomUUID(),
    two: crypto.randomUUID(),
    three: crypto.randomUUID(),
    four: crypto.randomUUID(),
  };
  const userIds = { user1: crypto.randomUUID() };

  const leadsRows = (Object.entries(leadIds) as [keyof typeof leadIds, string][]).map(
    ([key, id]) => ({
      id,
      nombre: `MergeCand Fixture Lead ${key}`,
      telefono: `+4${id.replace(/-/g, "").slice(0, 12)}`,
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2020,
      canal_origen: "wa" as const,
      meta_user_ids: {},
    }),
  );
  const { error: leadErr } = await c.from("leads").insert(leadsRows);
  if (leadErr) throw new Error(`seed leads: ${leadErr.message}`);

  const { error: userErr } = await c.from("usuarios").insert({
    id: userIds.user1,
    nombre: "MergeCand Fixture User",
    email: `merge-cand-user-${userIds.user1}@test.local`,
    rol: "admin",
  });
  if (userErr) throw new Error(`seed usuario: ${userErr.message}`);

  return { leadIds, userIds };
}
