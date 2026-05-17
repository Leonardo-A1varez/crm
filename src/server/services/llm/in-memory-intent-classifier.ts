import type { IntentClassification } from "@/lib/validation/ai";
import type {
  IntentClassifierInput,
  IntentClassifierLLM,
} from "@/server/services/intent-classifier.service";

/**
 * InMemory mock `IntentClassifierLLM` para `LLM_MODE=mock` (Slice 1 7.7.A).
 *
 * Retorna intent_nombre=null + confidence=0 → service consumidor lo trata como
 * "sin match" y dispara fallback humano/regla default. Permite ejercitar
 * pipeline E2E sin OpenAI key (staging, CI, dev local sin créditos).
 *
 * NO usar en producción — wireup factory garantiza solo `LLM_MODE=mock`.
 */
export class InMemoryIntentClassifierLLM implements IntentClassifierLLM {
  async classify(_input: IntentClassifierInput): Promise<IntentClassification> {
    return {
      intent_nombre: null,
      confidence: 0,
      razon: "[mock LLM_MODE=mock — sin clasificación real]",
    };
  }
}
