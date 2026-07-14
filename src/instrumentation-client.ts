import * as Sentry from "@sentry/nextjs";
import { redactSentryEvent } from "@/lib/observability/sentry-redact";

// Client-side Sentry (convención Next 15+/Turbopack). Sin DSN → disabled.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  // Errores solamente: tracing lo maneja OTel server-side.
  tracesSampleRate: 0,
  beforeSend: redactSentryEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
