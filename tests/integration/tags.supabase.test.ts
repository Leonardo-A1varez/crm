import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import type { TagsContractFixtures } from "../repositories/tags.contract";
import { runTagsContract } from "../repositories/tags.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;
let fixtures: TagsContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Tag-scoped cleanup: borra tags (cascade lead_tags). Preserva fixture
  // leads + usuarios, así contract puede usar mismas UUIDs across tests.
  const { error } = await client
    .from("tags")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup tags fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseTagsRepository (integration)", () => {
  runTagsContract(
    () => new SupabaseTagsRepository(client),
    () => fixtures,
  );
});

/**
 * Seed fixture leads + usuarios con UUIDs estables. Devuelve mapping para
 * pasar a contract. Telefonos derivados de UUID para garantizar unicidad
 * sin colisión con leads.contract baseInsert ("+595981000111" etc.).
 */
async function seedFixtures(c: TestClient): Promise<TagsContractFixtures> {
  const leadIds = {
    L1: crypto.randomUUID(),
    A: crypto.randomUUID(),
    B: crypto.randomUUID(),
    C: crypto.randomUUID(),
    empty: crypto.randomUUID(),
  };
  const userIds = {
    A: crypto.randomUUID(),
    B: crypto.randomUUID(),
    X: crypto.randomUUID(),
  };

  const usuariosRows = [
    { id: userIds.A, nombre: "Tags Fixture A", email: `tags-fix-a-${userIds.A}@test.local` },
    { id: userIds.B, nombre: "Tags Fixture B", email: `tags-fix-b-${userIds.B}@test.local` },
    { id: userIds.X, nombre: "Tags Fixture X", email: `tags-fix-x-${userIds.X}@test.local` },
  ];
  const { error: usrErr } = await c.from("usuarios").insert(usuariosRows);
  if (usrErr) throw new Error(`seed usuarios: ${usrErr.message}`);

  const leadsRows = (Object.entries(leadIds) as [keyof typeof leadIds, string][]).map(
    ([key, id]) => ({
      id,
      nombre: `Tags Fixture Lead ${key}`,
      // Telefono unique 13-char numérico derivado del UUID. Prefijo `+9` separa de
      // baseInsert leads contract ("+59598..." patrón) para no colisionar si los
      // tests corren en mismo schema.
      telefono: `+9${id.replace(/-/g, "").slice(0, 12)}`,
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2020,
      canal_origen: "wa" as const,
      meta_user_ids: {},
    }),
  );
  const { error: leadsErr } = await c.from("leads").insert(leadsRows);
  if (leadsErr) throw new Error(`seed leads: ${leadsErr.message}`);

  return {
    leadIds,
    userIds,
    unknownTagId: crypto.randomUUID(),
    unknownAssignedTagId: crypto.randomUUID(),
  };
}
