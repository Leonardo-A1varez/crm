import * as Sentry from "@sentry/nextjs";
import { redactSentryEvent } from "@/lib/observability/sentry-redact";

// Edge runtime (proxy). Sin DSN → disabled sin overhead.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  tracesSampleRate: 0,
  beforeSend: redactSentryEvent,
});
