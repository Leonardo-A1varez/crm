import type { InboxItem } from "@/types/inbox";

export type { InboxItem };

export interface InboxService {
  /**
   * Lista leads con sesión activa (resultado IS NULL), ordenados por última
   * actividad DESC. Enriquece con último mensaje de cualquier conversación del
   * lead y canales vinculados.
   */
  listActiveLeads(): Promise<InboxItem[]>;
}
