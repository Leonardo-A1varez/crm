import type { CostTracker, UsageRecord } from "@/lib/observability/cost-tracker";
import type { UUID } from "@/types/entities";

/**
 * Shape mínima que comparten `generateObject` y `generateText` results del
 * AI SDK v6: `result.usage.inputTokens` + `result.usage.outputTokens` (flat
 * numbers, undefined si el provider no los reporta).
 *
 * Definido localmente para evitar import-coupling a tipos específicos del SDK
 * (sobrevive a refactors menores del library).
 */
export interface LlmCallResultLike {
  usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
  };
}

export interface RecordUsageContext {
  model: string;
  workflow: string;
  sessionId?: UUID;
}

/**
 * Extrae usage tokens del response AI SDK y persiste en CostTracker.
 *
 * - Si provider no reporta tokens (undefined), persiste 0 (audit/debug; el
 *   gasto USD será 0 pero el record queda como evidencia de que se llamó).
 * - Llamado en `finally` del LLM impl: garantiza record incluso si el call
 *   throws antes de retornar (usage no estará disponible — guard con
 *   ?? 0). Para errores pre-call (cap exceeded, etc.) NO se llama.
 */
export async function recordLlmUsage(
  tracker: CostTracker,
  result: LlmCallResultLike,
  ctx: RecordUsageContext,
): Promise<void> {
  const record: UsageRecord = {
    model: ctx.model,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    workflow: ctx.workflow,
  };
  if (ctx.sessionId !== undefined) record.sessionId = ctx.sessionId;
  await tracker.record(record);
}
