import type { Canal, CurrentStage, Direction } from "./domain";
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
}

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
