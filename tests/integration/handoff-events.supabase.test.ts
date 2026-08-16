import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseHandoffEventsRepository } from "@/server/repositories/handoff-events.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { sembrarLead, sembrarSesion } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { HandoffEventsContractFixtures } from "../repositories/handoff-events.contract";
import { runHandoffEventsContract } from "../repositories/handoff-events.contract";

let client: TestClient;
let fixtures: HandoffEventsContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
});

beforeEach(async () => {
  // Las sesiones se recrean por test: `transition` las muta —pausa la IA y
  // mueve la etapa— y reusarlas haría que un test arranque desde el estado que
  // dejó el anterior.
  const { error } = await client
    .from("handoff_events")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup handoff_events fail: ${error.message}`);
  fixtures = await seedFixtures(client);
});

afterAll(async () => {
  await client.from("handoff_events").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await cleanupTestDb(client);
});

describe("SupabaseHandoffEventsRepository (integration)", () => {
  runHandoffEventsContract(
    () => new SupabaseHandoffEventsRepository(client, new SupabaseLeadSessionRepository(client)),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<HandoffEventsContractFixtures> {
  // Un lead por sesión: `lead_session_unique_activa_idx` admite una sola activa.
  const [leadA, leadB] = await Promise.all([
    sembrarLead(c, "handoff-a"),
    sembrarLead(c, "handoff-b"),
  ]);
  const [s1, s2] = await Promise.all([
    sembrarSesion(c, leadA, "handoff-a"),
    sembrarSesion(c, leadB, "handoff-b"),
  ]);
  return { sessionIds: { s1, s2 }, desconocida: crypto.randomUUID() };
}
