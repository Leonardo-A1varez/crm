import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.supabase.repo";
import { sembrarLead } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { LeadIdentificadoresContractFixtures } from "../repositories/lead-identificadores.contract";
import { runLeadIdentificadoresContract } from "../repositories/lead-identificadores.contract";

let client: TestClient;
let fixtures: LeadIdentificadoresContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Solo los identificadores: los tres leads son fixture y sobreviven.
  const { error } = await client
    .from("lead_identificadores")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup lead_identificadores fail: ${error.message}`);
});

afterAll(async () => {
  await client
    .from("lead_identificadores")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  await cleanupTestDb(client);
});

describe("SupabaseLeadIdentificadoresRepository (integration)", () => {
  runLeadIdentificadoresContract(
    () => new SupabaseLeadIdentificadoresRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<LeadIdentificadoresContractFixtures> {
  // El backfill de la migración le cuelga el teléfono a todo lead que nazca,
  // así que los tres arrancan con una fila que el `beforeEach` limpia.
  const [a, b, cc] = await Promise.all([
    sembrarLead(c, "ident-a"),
    sembrarLead(c, "ident-b"),
    sembrarLead(c, "ident-c"),
  ]);
  return { leadIds: { a, b, c: cc } };
}
