import type { Canal, CurrentStage, Direction, Prioridad } from "./domain";
import type { Lead, LeadSession, Mensaje, UUID } from "./entities";

/**
 * Item de inbox: lead con sesión activa + último mensaje + canales vinculados.
 * Forma derivada — no es entity DB. Producida por `InboxService.listActiveLeads`.
 * Vive en `types/` porque UI (components/) y service (server-services/) la
 * comparten — boundaries no permite components→server-services.
 */
export interface InboxItem {
  leadId: UUID;
  sessionId: UUID;
  nombre: string;
  currentStage: CurrentStage;
  iaPausada: boolean;
  ultimaActividad: Date;
  ultimoMensaje: {
    body: string;
    direction: Direction;
    createdAt: Date;
  } | null;
  canales: Canal[];
  /** Canal de la conversación con el mensaje más reciente. `null` sin canales. */
  canalActivo: Canal | null;
  /** Mensajes del cliente posteriores a la última respuesta nuestra. */
  sinResponder: number;
  /** Desde cuándo espera el primero de esos mensajes. */
  esperandoDesde: Date | null;
  prioridad: Prioridad;
  /** Por qué está priorizada; `null` cuando no hay nada que atender. */
  motivo: string | null;
}

/**
 * Resultado serializable de Server Actions inbox (8.4-8.5). Vive en types/
 * porque client components (components/) tipan la prop action y las actions
 * (app/) construyen el valor — boundaries no permite components→app.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Vista completa de conversación por lead (Slice 2 8.2). Producida por
 * `InboxService.getConversation`. `session` null cuando no hay sesión activa
 * (URL stale post-cierre); en ese caso `messages` vacío.
 */
export interface ConversationView {
  lead: Lead;
  session: LeadSession | null;
  // Mensajes de la sesión activa, ASC (viejo→nuevo), cap 200.
  messages: Mensaje[];
  // Canales con conversación existente (dedup).
  canales: Canal[];
  // Canal de la conversación con actividad más reciente; fallback canal_origen.
  canalActivo: Canal;
}
