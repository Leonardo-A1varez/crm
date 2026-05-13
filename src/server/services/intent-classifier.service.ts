import type { IntentsRepository } from "@/server/repositories/intents.repo";
import type { IntentClassification } from "@/lib/validation/ai";

export interface IntentCandidate {
  nombre: string;
  descripcion: string;
  ejemplos: string[];
}

export interface IntentClassifierInput {
  text: string;
  candidates: IntentCandidate[];
}

export interface IntentClassifierLLM {
  classify(input: IntentClassifierInput): Promise<IntentClassification>;
}

export interface IntentClassifierService {
  classify(text: string): Promise<IntentClassification>;
}

export class DefaultIntentClassifierService implements IntentClassifierService {
  constructor(
    private readonly intents: IntentsRepository,
    private readonly llm: IntentClassifierLLM,
  ) {}

  async classify(text: string): Promise<IntentClassification> {
    const activos = await this.intents.list({ activo: true });
    if (activos.length === 0) {
      return {
        intent_nombre: null,
        confidence: 0,
        razon: "sin intents configurados",
      };
    }

    const candidates: IntentCandidate[] = activos.map((i) => ({
      nombre: i.nombre,
      descripcion: i.descripcion,
      ejemplos: i.ejemplos,
    }));

    const result = await this.llm.classify({ text, candidates });

    if (result.intent_nombre !== null) {
      const known = activos.some((i) => i.nombre === result.intent_nombre);
      if (!known) {
        return {
          intent_nombre: null,
          confidence: 0,
          razon: `LLM devolvió intent desconocido: ${result.intent_nombre}`,
        };
      }
    }

    return result;
  }
}
