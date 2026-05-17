import type { LeadTwinUpdate } from "@/lib/validation/ai";
import type {
  TwinExtractorLLM,
  TwinExtractorLLMInput,
} from "@/server/services/twin-extractor.service";

/**
 * InMemory mock `TwinExtractorLLM` para `LLM_MODE=mock` (Slice 1 7.7.A).
 *
 * Retorna update vacío {} → shallow-merge en service no modifica session.
 * Permite que pipeline corra sin extraer datos reales.
 */
export class InMemoryTwinExtractorLLM implements TwinExtractorLLM {
  async extract(_input: TwinExtractorLLMInput): Promise<LeadTwinUpdate> {
    return {};
  }
}
