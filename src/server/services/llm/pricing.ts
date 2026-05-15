import type { PricingTable } from "@/lib/observability/cost-tracker";

/**
 * Pricing OpenAI conocidos. USD por 1M tokens.
 *
 * Source: https://openai.com/api/pricing/ (verificar al cambiar modelo default).
 * Update cadence: ~mensual o cuando OpenAI anuncia cambios.
 *
 * Modelos incluidos = los que actualmente usan los 5 LLM impls del CRM.
 * Si agregás un model nuevo (cambio default vía env OPENAI_MODEL), agregá su
 * entry aquí antes de deploy o el CostTracker.record() lanzará
 * ValidationError "model sin pricing configurado".
 */
export const OPENAI_PRICING: PricingTable = {
  "gpt-4o-mini": { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 },
  "gpt-4o": { inputUsdPer1M: 2.5, outputUsdPer1M: 10.0 },
  "gpt-4.1-mini": { inputUsdPer1M: 0.4, outputUsdPer1M: 1.6 },
  "gpt-4.1": { inputUsdPer1M: 2.0, outputUsdPer1M: 8.0 },
};

/** Modelo default para todos los LLM impls. Override per-LLM via constructor. */
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
