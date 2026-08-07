import type { PricingTable } from "@/lib/observability/cost-tracker";

/**
 * Pricing OpenAI conocidos. USD por 1M tokens.
 *
 * Source: https://developers.openai.com/api/docs/pricing
 * Familias gpt-4.1-nano y gpt-5* verificadas contra esa página 2026-08-07.
 * Update cadence: ~mensual o cuando OpenAI anuncia cambios.
 *
 * Esta tabla es la lista blanca de modelos: `makeLlmFactory` rechaza al boot
 * cualquier `OPENAI_MODEL*` que no tenga entry acá. Agregar un modelo nuevo
 * exige agregar su pricing primero — sin eso el kill switch de daily cap
 * quedaría calculando sobre datos inexistentes.
 *
 * Ojo con la familia gpt-5*: son modelos de razonamiento y los reasoning tokens
 * se facturan como output sin aparecer en la respuesta. El costo real de salida
 * puede ser varias veces el nominal. Medir antes de migrar workflows de volumen.
 */
export const OPENAI_PRICING: PricingTable = {
  "gpt-4o-mini": { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 },
  "gpt-4o": { inputUsdPer1M: 2.5, outputUsdPer1M: 10.0 },
  "gpt-4.1-nano": { inputUsdPer1M: 0.1, outputUsdPer1M: 0.4 },
  "gpt-4.1-mini": { inputUsdPer1M: 0.4, outputUsdPer1M: 1.6 },
  "gpt-4.1": { inputUsdPer1M: 2.0, outputUsdPer1M: 8.0 },
  "gpt-5-nano": { inputUsdPer1M: 0.05, outputUsdPer1M: 0.4 },
  "gpt-5-mini": { inputUsdPer1M: 0.25, outputUsdPer1M: 2.0 },
  "gpt-5.4-nano": { inputUsdPer1M: 0.2, outputUsdPer1M: 1.25 },
  "gpt-5.4-mini": { inputUsdPer1M: 0.75, outputUsdPer1M: 4.5 },
  "gpt-5.4": { inputUsdPer1M: 2.5, outputUsdPer1M: 15.0 },
  "gpt-5.5": { inputUsdPer1M: 5.0, outputUsdPer1M: 30.0 },
};

/** Modelo default para todos los LLM impls. Override via env OPENAI_MODEL*. */
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
