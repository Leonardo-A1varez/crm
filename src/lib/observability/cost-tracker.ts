import { ValidationError } from "@/lib/errors";
import type { UUID } from "@/types/entities";

// Cost tracker para LLM calls. Persiste usage records + computa daily spend.
// Provee kill switch via exceedsCap() — services LLM-callers consultan pre-call.
//
// Impls:
// - InMemoryCostTracker: tests + single-process dev.
// - VercelKvCostTracker (Fase 7): keys "cost:<YYYY-MM-DD>" con SUM atómica.
//
// Wireup Fase 11: cada OpenAI* impl wrap call con record() post-response usando
// usage tokens del SDK response. Pre-call check exceedsCap() para fail-fast.

export interface UsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  sessionId?: UUID;
  /** Mensaje entrante que originó el turno; ancla el gasto a un punto del hilo. */
  mensajeId?: UUID;
  workflow?: string;
  at?: Date;
}

export interface ModelPricing {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
}

export type PricingTable = Record<string, ModelPricing>;

export interface CostTracker {
  record(usage: UsageRecord): Promise<void>;
  getDailySpendUsd(day?: Date): Promise<number>;
  exceedsCap(day?: Date): Promise<boolean>;
}

export interface CostTrackerConfig {
  pricing: PricingTable;
  dailyCapUsd: number;
  now?: () => Date;
}

interface StoredRecord extends UsageRecord {
  usd: number;
  day: string;
}

/**
 * Lo que cuesta un uso, en USD. Exportada porque el tracker que persiste en
 * Postgres necesita el mismo número que el contador en memoria: si cada uno lo
 * calculara por su cuenta, el total diario y la suma de las filas guardadas se
 * separarían sin que nadie lo note.
 *
 * @throws ValidationError si el modelo no está en la tabla de precios.
 */
export function costoUsdDe(
  pricing: PricingTable,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = pricing[model];
  if (!price) {
    throw new ValidationError(`model sin pricing configurado: ${model}`);
  }
  return (
    (inputTokens / 1_000_000) * price.inputUsdPer1M +
    (outputTokens / 1_000_000) * price.outputUsdPer1M
  );
}

export class InMemoryCostTracker implements CostTracker {
  private readonly records: StoredRecord[] = [];

  constructor(private readonly config: CostTrackerConfig) {}

  async record(usage: UsageRecord): Promise<void> {
    const at = usage.at ?? this.currentTime();
    const usd = costoUsdDe(this.config.pricing, usage.model, usage.inputTokens, usage.outputTokens);
    this.records.push({ ...usage, usd, day: dayKey(at) });
  }

  async getDailySpendUsd(day?: Date): Promise<number> {
    const key = dayKey(day ?? this.currentTime());
    let total = 0;
    for (const r of this.records) {
      if (r.day === key) total += r.usd;
    }
    return total;
  }

  async exceedsCap(day?: Date): Promise<boolean> {
    const spend = await this.getDailySpendUsd(day);
    return spend >= this.config.dailyCapUsd;
  }

  private currentTime(): Date {
    return (this.config.now ?? (() => new Date()))();
  }
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
