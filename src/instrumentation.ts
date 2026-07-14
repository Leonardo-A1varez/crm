import * as Sentry from "@sentry/nextjs";
import { registerOTel } from "@vercel/otel";

/**
 * Instrumentation Next: OTel primero (spans → Vercel observability en deploy,
 * no-op local), después Sentry por runtime (errores; sin DSN = disabled).
 */
export async function register() {
  registerOTel({ serviceName: "crm" });

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
