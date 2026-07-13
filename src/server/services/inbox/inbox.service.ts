import type { ConversationView, InboxItem } from "@/types/inbox";
import type { UUID } from "@/types/entities";

export type { ConversationView, InboxItem };

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
}
