import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import type { MessagesContractFixtures } from "../repositories/messages.contract";
import { runMessagesContract } from "../repositories/messages.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;
let fixtures: MessagesContractFixtures;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
  fixtures = await seedFixtures(client);
});

beforeEach(async () => {
  // Cleanup mensajes-only — preserva fixture lead/lead_session/conversaciones.
  const { error } = await client
    .from("mensajes")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup mensajes fail: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

describe("SupabaseMessagesRepository (integration)", () => {
  runMessagesContract(
    () => new SupabaseMessagesRepository(client),
    () => fixtures,
  );
});

async function seedFixtures(c: TestClient): Promise<MessagesContractFixtures> {
  const leadId = crypto.randomUUID();
  const conversacionIds = {
    one: crypto.randomUUID(),
    A: crypto.randomUUID(),
    B: crypto.randomUUID(),
  };
  const leadSessionId = crypto.randomUUID();
  // Sesión alt en OTRO lead: constraint lead_session_unique_activa_idx permite
  // 1 sola sesión activa por lead.
  const leadIdAlt = crypto.randomUUID();
  const leadSessionIdAlt = crypto.randomUUID();

  // 2 leads parent (main + alt para listBySessionId isolation).
  const { error: leadErr } = await c.from("leads").insert([
    {
      id: leadId,
      nombre: "Messages Fixture Lead",
      telefono: `+7${leadId.replace(/-/g, "").slice(0, 12)}`,
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2020,
      canal_origen: "wa",
      meta_user_ids: {},
    },
    {
      id: leadIdAlt,
      nombre: "Messages Fixture Lead Alt",
      telefono: `+7${leadIdAlt.replace(/-/g, "").slice(0, 12)}`,
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Hilux",
      vehiculo_anio: 2021,
      canal_origen: "wa",
      meta_user_ids: {},
    },
  ]);
  if (leadErr) throw new Error(`seed leads: ${leadErr.message}`);

  // 1 lead_session por lead.
  const { error: sessErr } = await c.from("lead_session").insert([
    { id: leadSessionId, lead_id: leadId },
    { id: leadSessionIdAlt, lead_id: leadIdAlt },
  ]);
  if (sessErr) throw new Error(`seed lead_session: ${sessErr.message}`);

  // 3 conversaciones distintas (mismo lead, distinto canal_thread_id para satisfacer
  // UNIQUE (canal, canal_thread_id)).
  const convRows = (
    Object.entries(conversacionIds) as [keyof typeof conversacionIds, string][]
  ).map(([key, id]) => ({
    id,
    lead_id: leadId,
    canal: "wa" as const,
    canal_thread_id: `msg-fix-${key}-${id.slice(0, 8)}`,
  }));
  const { error: convErr } = await c.from("conversaciones").insert(convRows);
  if (convErr) throw new Error(`seed conversaciones: ${convErr.message}`);

  return { conversacionIds, leadSessionId, leadSessionIdAlt };
}
