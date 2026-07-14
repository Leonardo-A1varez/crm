import { redactPii } from "./redact";
import type { ErrorEvent as SentryErrorEvent } from "@sentry/nextjs";

/**
 * beforeSend de Sentry: misma política PII que los logs (regla §0.9.1).
 * request.data se elimina entero — bodies de webhooks traen mensajes de leads.
 */
export function redactSentryEvent(event: SentryErrorEvent): SentryErrorEvent {
  if (event.extra) {
    event.extra = redactPii(event.extra) as typeof event.extra;
  }
  if (event.contexts) {
    event.contexts = redactPii(event.contexts) as typeof event.contexts;
  }
  if (event.request?.data !== undefined) {
    delete event.request.data;
  }
  return event;
}
