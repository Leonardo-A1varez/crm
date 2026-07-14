import { SpanStatusCode, trace } from "@opentelemetry/api";

/**
 * Span helper para puntos calientes (webhook, LLM, Meta send). Sin PII en
 * attrs: ids/canal/counts OK, bodies/telefonos NO. Local sin collector = no-op.
 */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer("crm");
  return tracer.startActiveSpan(name, { attributes: attrs }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (e) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: e instanceof Error ? e.name : "error",
      });
      if (e instanceof Error) span.recordException(e);
      throw e;
    } finally {
      span.end();
    }
  });
}
