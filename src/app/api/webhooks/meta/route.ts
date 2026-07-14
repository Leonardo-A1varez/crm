/**
 * Webhook Meta — `/api/webhooks/meta` (Slice 1 sub-paso 7.9).
 *
 * GET handshake: Meta dashboard verifica endpoint con `hub.mode=subscribe` +
 * `hub.verify_token`. Si match `env.META_VERIFY_TOKEN` → 200 `hub.challenge`.
 *
 * POST inbound: pipeline obligatorio regla §0.9.2:
 *   1. Rate-limit per IP (Upstash si configured, sino Noop fail-open dev).
 *   2. Read rawBody ANTES de JSON.parse (HMAC sobre bytes raw, JSON re-stringify
 *      cambia bytes y rompe verify).
 *   3. HMAC SHA-256 verify primera línea con `META_APP_SECRET`. Fail → 401.
 *   4. JSON.parse rawBody → parseMetaWebhook → ParsedMessage[].
 *   5. Emit Inngest event `meta/message.received` per parsed message.
 *   6. 200 OK rápido (Meta enforce <20s response).
 *
 * Factory pattern (`makeMetaWebhookHandlers`) para DI en tests.
 */

import { env } from "@/lib/env";
import { inngest } from "@/inngest/client";
import type { CrmInngestClient } from "@/inngest/client";
import { parseMetaWebhook } from "@/lib/meta/parse-webhook";
import { verifyMetaSignature } from "@/lib/meta/verify-signature";
import { getLogger } from "@/lib/observability/get-logger";
import { withSpan } from "@/lib/observability/tracing";
import type { Logger } from "@/lib/observability/logger";
import { makeRateLimiterFromEnv, type RateLimiter } from "@/lib/rate-limit";

export interface MetaWebhookHandlersDeps {
  appSecret: string;
  verifyToken: string;
  inngest: Pick<CrmInngestClient, "send">;
  rateLimiter: RateLimiter;
  logger: Logger;
}

export function makeMetaWebhookHandlers(deps: MetaWebhookHandlersDeps) {
  return {
    async GET(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge") ?? "";

      if (mode !== "subscribe" || token !== deps.verifyToken) {
        deps.logger.warn("meta.webhook.verify.denied", { mode, hasToken: token !== null });
        return new Response("Forbidden", { status: 403 });
      }

      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    },

    async POST(req: Request): Promise<Response> {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

      // 1. Rate-limit per IP. Bloquea bursts antes de HMAC check (HMAC cuesta CPU).
      const limit = await deps.rateLimiter.limit(`meta-webhook:${ip}`);
      if (!limit.success) {
        deps.logger.warn("meta.webhook.rate_limited", { ip, reset: limit.reset });
        const retryAfter = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        });
      }

      // 2. Read rawBody PRE JSON.parse. HMAC sobre bytes exactos enviados por Meta.
      const rawBody = await req.text();

      // 3. HMAC verify primera línea (regla §0.9.2).
      const signature = req.headers.get("X-Hub-Signature-256");
      if (!verifyMetaSignature(rawBody, signature, deps.appSecret)) {
        deps.logger.warn("meta.webhook.hmac.invalid", { ip });
        return new Response("Unauthorized", { status: 401 });
      }

      // 4. JSON.parse. Si rawBody mal-formed → 400 (HMAC pasa con bytes válidos
      //    pero contenido roto = Meta bug o attacker malformed).
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        deps.logger.warn("meta.webhook.json.invalid", { ip });
        return new Response("Bad Request", { status: 400 });
      }

      // 5. Parse → ParsedMessage[]. Object desconocido (no whatsapp/instagram/page)
      //    retorna [] y respondemos 200 OK (don't make Meta retry).
      const parsed = parseMetaWebhook(payload);
      deps.logger.info("meta.webhook.parsed", { ip, count: parsed.length });

      // 6. Emit per parsed message. Inngest send es retry-resilient (cliente
      //    persiste en Inngest infra). Errores aquí → 500 + Meta retry.
      for (const message of parsed) {
        await deps.inngest.send({
          name: "meta/message.received",
          data: { parsed: message },
        });
      }

      return new Response("OK", { status: 200 });
    },
  };
}

// ============================================================================
// Default singleton — runtime real deps from env
// ============================================================================
const defaultDeps: MetaWebhookHandlersDeps = {
  appSecret: env.META_APP_SECRET,
  verifyToken: env.META_VERIFY_TOKEN,
  inngest,
  rateLimiter: makeRateLimiterFromEnv({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    limit: 100,
    window: "1 m",
    prefix: "meta-webhook",
  }),
  logger: getLogger({ scope: "webhook-meta" }),
};

const handlers = makeMetaWebhookHandlers(defaultDeps);
export const GET = handlers.GET;
export const POST = (req: Request) => withSpan("webhook.meta.post", {}, () => handlers.POST(req));
