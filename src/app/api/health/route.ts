import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Health check para monitores (regla §0.10.4). Público: solo estados, sin
 * mensajes de error crudos ni info interna. DB con client anon (zones
 * prohíben service-role en app/**; `server_now()` tiene grant a anon).
 *
 * status: "down" (503) solo si DB falla; checks externos con creds
 * placeholder quedan "skipped" (dev) y fallas externas degradan sin tumbar.
 */

type CheckState = "ok" | "fail" | "skipped";

export interface HealthDeps {
  checkDb: () => Promise<boolean>;
  inngestKey: string;
  openaiKey: string;
  fetchFn?: typeof fetch;
}

const CHECK_TIMEOUT_MS = 3_000;

function isPlaceholder(value: string): boolean {
  return value.includes("placeholder") || value.startsWith("test-") || value.length === 0;
}

export function makeHealthHandler(deps: HealthDeps): () => Promise<Response> {
  const fetchFn = deps.fetchFn ?? fetch;

  async function ping(url: string): Promise<CheckState> {
    try {
      const res = await fetchFn(url, {
        method: "GET",
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      return res.ok || res.status < 500 ? "ok" : "fail";
    } catch {
      return "fail";
    }
  }

  return async () => {
    const db: CheckState = (await deps.checkDb().catch(() => false)) ? "ok" : "fail";

    const inngest: CheckState = isPlaceholder(deps.inngestKey)
      ? "skipped"
      : await ping("https://api.inngest.com/health");

    const openai: CheckState = isPlaceholder(deps.openaiKey)
      ? "skipped"
      : await ping("https://api.openai.com/v1/models");

    const checks = { db, inngest, openai };
    const status =
      db === "fail" ? "down" : Object.values(checks).every((c) => c === "ok") ? "ok" : "degraded";

    return Response.json({ status, checks }, { status: status === "down" ? 503 : 200 });
  };
}

async function defaultCheckDb(): Promise<boolean> {
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { error } = await anon.rpc("server_now");
  return error === null;
}

const handler = makeHealthHandler({
  checkDb: defaultCheckDb,
  inngestKey: env.INNGEST_SIGNING_KEY,
  openaiKey: env.OPENAI_API_KEY,
});

export const dynamic = "force-dynamic";
export const GET = handler;
