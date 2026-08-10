import type { IntentsRepository } from "@/server/repositories/intents.repo";
import type { IntentClassification } from "@/lib/validation/ai";
import type { UUID } from "@/types/entities";

export interface IntentCandidate {
  nombre: string;
  descripcion: string;
  ejemplos: string[];
}

export interface IntentClassifierInput {
  text: string;
  candidates: IntentCandidate[];
  /**
   * Mensaje entrante que se está clasificando. No cambia la clasificación: es
   * lo que le permite al registro de gasto decir a qué turno y a qué sesión
   * pertenece esta llamada. Sin él, el clasificador aparece como gasto
   * huérfano y el costo por lead queda incompleto.
   */
  mensajeId?: UUID;
  leadSessionId?: UUID;
}

export interface IntentClassifierLLM {
  classify(input: IntentClassifierInput): Promise<IntentClassification>;
}

/** Origen del mensaje que se clasifica; solo se usa para atribuir el gasto. */
export interface ClassifyOrigen {
  mensajeId?: UUID;
  leadSessionId?: UUID;
}

export interface IntentClassifierService {
  classify(text: string, origen?: ClassifyOrigen): Promise<IntentClassification>;
}

export class DefaultIntentClassifierService implements IntentClassifierService {
  constructor(
    private readonly intents: IntentsRepository,
    private readonly llm: IntentClassifierLLM,
  ) {}

  async classify(text: string, origen: ClassifyOrigen = {}): Promise<IntentClassification> {
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

    const result = await this.llm.classify({
      text,
      candidates,
      ...(origen.mensajeId ? { mensajeId: origen.mensajeId } : {}),
      ...(origen.leadSessionId ? { leadSessionId: origen.leadSessionId } : {}),
    });

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
