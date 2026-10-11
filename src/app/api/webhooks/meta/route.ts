/**
 * Webhook Meta — `/api/webhooks/meta` (Slice 1 sub-paso 7.9).
 *
 * GET handshake: Meta dashboard verifica endpoint con `hub.mode=subscribe` +
 * `hub.verify_token`. Si match `env.META_VERIFY_TOKEN` → 200 `hub.challenge`.
 *
 * POST inbound: pipeline obligatorio regla §0.9.2:
 *   1. Read rawBody ANTES de JSON.parse (HMAC sobre bytes raw, JSON re-stringify
 *      cambia bytes y rompe verify).
 *   2. HMAC SHA-256 verify antes de dependencias externas. Fail → 401.
 *   3. Rate-limit per IP, solo después de autenticar el origen.
 *   4. JSON.parse rawBody → parseMetaWebhook → ParsedMessage[].
 *   5. Emit Inngest event `meta/message.received` per parsed message.
 *   6. 200 OK rápido (Meta enforce <20s response).
 *
 * Factory pattern (`makeMetaWebhookHandlers`) para DI en tests.
 */

import { env } from "@/lib/env";
import { inngest } from "@/inngest/client";
import type { CrmInngestClient } from "@/inngest/client";
import {
  parseMetaOperationalEvents,
  parseMetaStatuses,
  parseMetaWebhook,
} from "@/lib/meta/parse-webhook";
import { parseCoexistencia, partirLote, serializarMensaje } from "@/lib/meta/parse-coexistencia";
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

      // 1. Read rawBody PRE JSON.parse. HMAC sobre bytes exactos enviados por Meta.
      const rawBody = await req.text();

      // 2. HMAC antes de rate-limit, parser o Inngest (regla §0.9.2).
      const signature = req.headers.get("X-Hub-Signature-256");
      if (!verifyMetaSignature(rawBody, signature, deps.appSecret)) {
        deps.logger.warn("meta.webhook.hmac.invalid", { ip });
        return new Response("Unauthorized", { status: 401 });
      }

      // 3. Un request sin firma no puede consumir cuota de Redis ni provocar
      // un 429 a Meta. HMAC es local y barato; el rate limit protege el origen
      // autenticado antes de tocar Inngest.
      const limit = await deps.rateLimiter.limit(`meta-webhook:${ip}`);
      if (!limit.success) {
        deps.logger.warn("meta.webhook.rate_limited", { ip, reset: limit.reset });
        const retryAfter = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        });
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

      // 7. Estados de entrega. Vienen en el mismo POST que los mensajes y hasta
      //    ahora se descartaban, asi que la UI no sabia si un saliente habia
      //    llegado. `at` viaja en ISO: una Date no sobrevive el JSON del evento.
      const statuses = parseMetaStatuses(payload);
      if (statuses.length > 0) {
        deps.logger.info("meta.webhook.statuses", { ip, count: statuses.length });
      }
      for (const status of statuses) {
        await deps.inngest.send({
          name: "meta/status.received",
          data: { parsed: { ...status, at: status.at.toISOString() } },
        });
      }

      // 8. Eventos operativos de la plataforma: plantilla aprobada o rechazada,
      //    cambio de limite del numero, revision de la cuenta. Hasta el
      //    2026-08-25 se descartaban en silencio junto con todo `field` que no
      //    fuera `messages`, asi que un rechazo de plantilla no se sabia hasta
      //    que fallaba un envio.
      const operativos = parseMetaOperationalEvents(payload);
      if (operativos.length > 0) {
        deps.logger.info("meta.webhook.operational", { ip, count: operativos.length });
      }
      for (const ev of operativos) {
        await deps.inngest.send({
          name: "meta/operational.received",
          data: { ...ev, ocurrido_at: ev.ocurrido_at?.toISOString() ?? null },
        });
      }

      // 9. Coexistencia (número que sigue en la app WhatsApp Business): el
      //    historial de 180 días, los contactos y lo que el negocio manda desde
      //    el teléfono. Van por su propio camino y NUNCA por
      //    `meta/message.received`: no son turnos y el agente no los contesta.
      //    Solo cantidades en el log: traen teléfonos y textos.
      const coex = parseCoexistencia(payload);
      const totalCoex =
        coex.historial.length +
        coex.historialErrores.length +
        coex.contactos.length +
        coex.ecos.length;
      if (totalCoex > 0) {
        deps.logger.info("meta.webhook.coexistencia", {
          ip,
          historial: coex.historial.length,
          historial_errores: coex.historialErrores.length,
          contactos: coex.contactos.length,
          ecos: coex.ecos.length,
        });
      }
      for (const lote of coex.historial) {
        for (const parte of partirLote(lote)) {
          const primero = parte.hilos[0]?.mensajes[0]?.meta_message_id ?? "vacio";
          await deps.inngest.send({
            name: "meta/coexistencia.historial",
            data: { lote: parte },
            // Reentrega de Meta: la misma parte no se encola dos veces (además
            // de la dedup por wamid al importar).
            id: `coexistencia-historial:${parte.phone_number_id}:${parte.fase ?? "x"}:${parte.chunk ?? "x"}:${primero}`,
          });
        }
      }
      for (const error of coex.historialErrores) {
        await deps.inngest.send({ name: "meta/coexistencia.historial-error", data: error });
      }
      for (let i = 0; i < coex.contactos.length; i += CONTACTOS_POR_EVENTO) {
        await deps.inngest.send({
          name: "meta/coexistencia.contactos",
          data: { contactos: coex.contactos.slice(i, i + CONTACTOS_POR_EVENTO) },
        });
      }
      for (const eco of coex.ecos) {
        await deps.inngest.send({
          name: "meta/coexistencia.eco",
          data: { eco: { ...eco, mensaje: serializarMensaje(eco.mensaje) } },
          // Meta reentrega: el mismo eco no se encola dos veces.
          id: `coexistencia-eco:${eco.mensaje.meta_message_id}`,
        });
      }

      return new Response("OK", { status: 200 });
    },
  };
}

/** Contactos por evento: entra holgado en el tope de tamaño de Inngest. */
const CONTACTOS_POR_EVENTO = 200;

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
