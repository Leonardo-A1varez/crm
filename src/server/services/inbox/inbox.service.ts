import type { ConversationView, InboxItem } from "@/types/inbox";
import type { Canal, MotivoPerdida, Resultado } from "@/types/domain";
import type { LeadSession, Mensaje, UUID } from "@/types/entities";

export type { ConversationView, InboxItem };

export interface SendMessageServiceInput {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  body: string;
}

export interface ToggleHandoffServiceInput {
  sessionId: UUID;
  action: "pause" | "resume";
}

export interface CloseSessionServiceInput {
  sessionId: UUID;
  resultado: Resultado;
  motivoPerdida?: MotivoPerdida | null;
}

export interface InboxService {
  /**
   * Lista leads con sesión activa (resultado IS NULL), ordenados por última
   * actividad DESC. Enriquece con último mensaje de cualquier conversación del
   * lead y canales vinculados.
   */
  listActiveLeads(): Promise<InboxItem[]>;

  /**
   * Vista conversación de un lead: lead + sesión activa (null si no hay) +
   * mensajes de la sesión ASC (cap 200) + canales vinculados + canal activo.
   * Lanza NotFoundError cuando el lead no existe.
   */
  getConversation(leadId: UUID): Promise<ConversationView>;

  /**
   * Envío manual del vendedor. Valida sesión activa + pertenencia al lead,
   * resuelve conversación del canal (to = canal_thread_id) y delega en
   * MetaApiService.sendOutbound (send Meta → persist → touch). Si Meta falla,
   * propaga sin persistir.
   */
  sendMessage(input: SendMessageServiceInput): Promise<Mensaje>;

  /**
   * Pausa/reanuda IA de la sesión (handoff manual). Idempotente; ConflictError
   * si la sesión está cerrada.
   */
  toggleHandoff(input: ToggleHandoffServiceInput): Promise<LeadSession>;

  /**
   * Cierra sesión con resultado (+ motivo si perdido). Replay idéntico es
   * no-op; cierre con resultado distinto lanza IllegalStateError.
   */
  closeSession(input: CloseSessionServiceInput): Promise<LeadSession>;
}
