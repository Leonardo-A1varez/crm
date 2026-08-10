import { costoUsdDe, type CostTracker, type PricingTable } from "@/lib/observability/cost-tracker";
import type { UsageRecord } from "@/lib/observability/cost-tracker";
import type { Logger } from "@/lib/observability/logger";
import type { LlmUsageRepository } from "@/server/repositories/llm-usage.repo";

export interface PersistingCostTrackerConfig {
  /** El contador que ya existía: total diario en proceso (o Upstash) + kill switch. */
  inner: CostTracker;
  repo: LlmUsageRepository;
  /** La misma tabla que usa `inner`, para que los dos números no se separen. */
  pricing: PricingTable;
  logger?: Logger;
}

/**
 * `CostTracker` que además deja el gasto escrito en Postgres, una fila por
 * llamada al modelo.
 *
 * Decora en vez de reemplazar: el contador de adentro sigue resolviendo el
 * total del día y el kill switch, y lo que se agrega es el registro histórico
 * —sesión, mensaje, modelo, tokens, costo y workflow— que es lo único con lo
 * que se puede responder cuánto costó una conversación o un lead.
 *
 * Vive en `server/services/llm/` y no junto a `CostTracker` en `lib/` porque
 * las zonas de ESLint prohíben que `lib/**` importe repositorios.
 *
 * **La escritura es best-effort a propósito.** Cuando esto corre, la llamada al
 * modelo ya se hizo y ya se pagó: propagar un fallo de la fila de auditoría
 * abortaría el turno, Inngest lo reintentaría y se pagaría de nuevo el mismo
 * turno. Se pierde una fila y queda el error en el log, que es el daño menor.
 * El costo del turno no se pierde del total del día: eso lo lleva `inner`, que
 * corre antes y sí propaga.
 */
export class PersistingCostTracker implements CostTracker {
  constructor(private readonly cfg: PersistingCostTrackerConfig) {}

  async record(usage: UsageRecord): Promise<void> {
    // Primero el contador: valida el pricing y es el que sostiene el corte
    // diario. Si el modelo no tiene precio, nada que persistir.
    await this.cfg.inner.record(usage);

    try {
      await this.cfg.repo.create({
        lead_session_id: usage.sessionId ?? null,
        mensaje_id: usage.mensajeId ?? null,
        modelo: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        costo_usd: costoUsdDe(this.cfg.pricing, usage.model, usage.inputTokens, usage.outputTokens),
        workflow: usage.workflow ?? "desconocido",
        ...(usage.at ? { created_at: usage.at } : {}),
      });
    } catch (e) {
      // Sin PII: acá solo hay ids, nombre de modelo y números.
      this.cfg.logger?.error("llm_usage.persistencia_fallida", {
        workflow: usage.workflow ?? null,
        modelo: usage.model,
        error_name: (e as Error).name,
        error_message: (e as Error).message,
      });
    }
  }

  async getDailySpendUsd(day?: Date): Promise<number> {
    return this.cfg.inner.getDailySpendUsd(day);
  }

  async exceedsCap(day?: Date): Promise<boolean> {
    return this.cfg.inner.exceedsCap(day);
  }
}
