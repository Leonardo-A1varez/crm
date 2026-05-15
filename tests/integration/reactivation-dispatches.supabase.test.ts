import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseReactivationDispatchesRepository } from "@/server/repositories/reactivation-dispatches.supabase.repo";
import type { ReactivationDispatchesContractFixtures } from "../repositories/reactivation-dispatches.contract";
import { runReactivationDispatchesContract } from "../repositories/reactivation-dispatches.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;
let fixtures: ReactivationDispatchesContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Cleanup reactivation_dispatches-only — preserva fixture lead/lead_sessions.
  const { error } = await client
    .from("reactivation_dispatches")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup reactivation_dispatches fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseReactivationDispatchesRepository (integration)", () => {
  runReactivationDispatchesContract(
    () => new SupabaseReactivationDispatchesRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<ReactivationDispatchesContractFixtures> {
  // 6 lead_sessions, c/u con lead distinto (partial unique 1 sesión activa per lead).
  const leadSessionIds = {
    session1: crypto.randomUUID(),
    sessionX: crypto.randomUUID(),
    sA: crypto.randomUUID(),
    sB: crypto.randomUUID(),
    sList: crypto.randomUUID(),
    other: crypto.randomUUID(),
  };
  const leadIds: Record<keyof typeof leadSessionIds, string> = {
    session1: crypto.randomUUID(),
    sessionX: crypto.randomUUID(),
    sA: crypto.randomUUID(),
    sB: crypto.randomUUID(),
    sList: crypto.randomUUID(),
    other: crypto.randomUUID(),
  };

  const leadsRows = (Object.entries(leadIds) as [keyof typeof leadIds, string][]).map(
    ([key, id]) => ({
      id,
      nombre: `Reactivation Fixture Lead ${key}`,
      telefono: `+3${id.replace(/-/g, "").slice(0, 12)}`,
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2020,
      canal_origen: "wa" as const,
      meta_user_ids: {},
    }),
  );
  const { error: leadErr } = await c.from("leads").insert(leadsRows);
  if (leadErr) throw new Error(`seed leads: ${leadErr.message}`);

  const sessRows = (Object.entries(leadSessionIds) as [keyof typeof leadSessionIds, string][]).map(
    ([key, id]) => ({
      id,
      lead_id: leadIds[key],
      consulta: `reactivation fixture ${key}`,
    }),
  );
  const { error: sessErr } = await c.from("lead_session").insert(sessRows);
  if (sessErr) throw new Error(`seed lead_session: ${sessErr.message}`);

  return { leadSessionIds };
}
