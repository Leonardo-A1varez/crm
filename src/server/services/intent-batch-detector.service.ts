/**
 * Interfaces compartidas para el detector batch de intents.
 *
 * Vive en `server-services/` (no en `inngest/`) para que las impls LLM
 * (también en `server-services/`) puedan importar sin violar boundaries
 * ESLint (inngest puede importar de server-services, no al revés).
 *
 * Handler Inngest (`detect-intents.batch`) re-importa desde aquí.
 */

import type { UUID } from "@/types/entities";

export interface DetectedIntent {
  nombre: string;
  descripcion: string;
  ejemplos: string[];
}

export interface BatchSessionInput {
  sessionId: UUID;
  leadId: UUID;
  messages: string[];
}

export interface IntentBatchDetectorInput {
  sessions: BatchSessionInput[];
}

export interface IntentBatchDetectorLLM {
  detect(input: IntentBatchDetectorInput): Promise<DetectedIntent[]>;
}
