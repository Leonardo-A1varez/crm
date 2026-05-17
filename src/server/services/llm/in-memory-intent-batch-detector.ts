import type {
  DetectedIntent,
  IntentBatchDetectorInput,
  IntentBatchDetectorLLM,
} from "@/server/services/intent-batch-detector.service";

/**
 * InMemory mock `IntentBatchDetectorLLM` para `LLM_MODE=mock` (Slice 1 7.7.A).
 *
 * Retorna array vacío → cron weekly detect-intents.batch corre sin proponer
 * intents nuevos. Admin sigue agregando manual hasta switch a real.
 */
export class InMemoryIntentBatchDetectorLLM implements IntentBatchDetectorLLM {
  async detect(_input: IntentBatchDetectorInput): Promise<DetectedIntent[]> {
    return [];
  }
}
