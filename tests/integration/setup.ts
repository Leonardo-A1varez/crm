import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/types.gen";

/**
 * Integration test infrastructure — Slice 1 7.4+.
 *
 * Env vars obligatorios:
 *   SUPABASE_TEST_URL              URL del proyecto Supabase dev (crm-dev).
 *   SUPABASE_TEST_SERVICE_KEY      service_role key (bypass RLS).
 *
 * Razón service-role: tests necesitan TRUNCATE entre tests + insertar sin RLS.
 * NO usar el mismo proyecto prod.
 */

export type TestClient = SupabaseClient<Database>;

// Tables with single `id` PK ordered: children → parents (CASCADE handles rest).
// lead_tags (composite PK lead_id+tag_id) NOT listed — cascades from leads/tags.
const TABLES_TO_TRUNCATE = [
  "session_recordatorios",
  "event_outbox",
  "merge_candidates",
  "admin_actions",
  "tool_executions",
  "reactivation_dispatches",
  "rule_executions",
  "mensajes",
  "conversaciones",
  "lead_session",
  "leads",
  "tags",
  "reglas",
  "intents",
  "productos",
  "usuarios",
  "empresas",
] as const;

export function makeTestSupabaseClient(): TestClient {
  const url = process.env["SUPABASE_TEST_URL"];
  const key = process.env["SUPABASE_TEST_SERVICE_KEY"];
  if (!url || !key) {
    throw new Error(
      "Integration tests requieren env SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_KEY. " +
        "Ver tests/integration/setup.ts.",
    );
  }
  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: { schema: "public" },
  });
}

/**
 * TRUNCATE bulk via RPC custom o per-table DELETE. Como Supabase no expone
 * TRUNCATE via PostgREST directamente, usamos DELETE all rows (más lento pero
 * compatible con RLS off via service-role).
 *
 * CASCADE semantics: cada DELETE respeta FK cascades configurados en migrations.
 * Orden importa: tablas hijas primero, padres después.
 */
export async function cleanupTestDb(client: TestClient): Promise<void> {
  for (const table of TABLES_TO_TRUNCATE) {
    const { error } = await client
      .from(table)
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      throw new Error(`cleanupTestDb fail table=${table}: ${error.message}`);
    }
  }
}

/**
 * Wrapper helper: returns client + cleanup fn. Caller uses dentro de
 * beforeEach/afterAll scope.
 */
export function withCleanDb() {
  const client = makeTestSupabaseClient();
  return { client, cleanup: () => cleanupTestDb(client) };
}
