import { serve } from "inngest/next";
import { env } from "@/lib/env";
import { inngest } from "@/inngest/client";
import { defaultDbClientFactory } from "@/server/db/client";
import { makeInngestDeps } from "@/inngest/bootstrap";
import { makeCrmInngestFunctions } from "@/inngest/functions";

/**
 * Inngest serve handler — Slice 1 sub-paso 7.8.
 *
 * Mounta los 9 Inngest functions con deps reales (Supabase repos + Default
 * services + LLM factory 7.7.A + GraphApiMetaClient). Lazy init: bootstrap
 * corre 1 vez per Vercel function instance (cold start), no per request.
 *
 * Inngest Dev Server local: `npm run inngest:dev` (default puerto 8288).
 * Cloud: webhook `/api/webhooks/inngest` registrado en Inngest dashboard.
 */

const db = defaultDbClientFactory().serviceRole();
const { deps } = makeInngestDeps({ env, db, inngest });
const functions = makeCrmInngestFunctions(deps);

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
