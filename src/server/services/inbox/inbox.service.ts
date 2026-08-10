import type { ConversationView, InboxItem } from "@/types/inbox";
import type { CampoTwinEditable, Canal, MotivoPerdida, Resultado } from "@/types/domain";
import type { Lead, LeadSession, Mensaje, Tag, UUID } from "@/types/entities";

export type { ConversationView, InboxItem };

export interface SendMessageServiceInput {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  body: string;
  /**
   * Quién lo manda. Va a `mensajes.sender_user_id` y es la única forma de
   * saber después qué vendedor atendió qué conversación. `null` solo si la
   * llamada no viene de una sesión autenticada.
   */
  userId: UUID | null;
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

export interface EditarCampoTwinServiceInput {
  sessionId: UUID;
  campo: CampoTwinEditable;
  valor: string | number | null;
  userId: UUID | null;
}

export interface RenombrarLeadServiceInput {
  leadId: UUID;
  /** Vacío = el lead vuelve a "sin identificar"; no es un error. */
  nombre: string;
}

export interface EtiquetaLeadServiceInput {
  leadId: UUID;
  tagId: UUID;
  /** Quién la puso. Va a `lead_tags.assigned_by`; solo lo usa el alta. */
  userId?: UUID | null;
}

export interface CrearEtiquetaServiceInput {
  leadId: UUID;
  nombre: string;
  userId: UUID | null;
}

export interface InboxService {
  /**
   * Lista leads con sesión activa (resultado IS NULL), ordenados por última
   * actividad DESC. Enriquece con último mensaje de cualquier conversación del
   * lead y canales vinculados.
   */
  listActiveLeads(): Promise<InboxItem[]>;

  /**
   * Cuántas conversaciones activas requieren a una persona (las del grupo
   * "Requieren tu atención"). Existe aparte de `listActiveLeads` porque el
   * badge del SideNav se pinta en las 7 pantallas del panel: el triage mira
   * solo la sesión, así que contar es una query y no un hilo por lead.
   */
  contarRequierenAtencion(): Promise<number>;

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

  /**
   * Corrige a mano un campo del Twin y deja la marca de procedencia. Lanza
   * NotFoundError si la sesión no existe, ConflictError si está cerrada: una
   * ficha cerrada es historial y no se reescribe.
   */
  editarCampoTwin(input: EditarCampoTwinServiceInput): Promise<LeadSession>;

  /**
   * Pone el nombre con el que la casa identifica al lead. El pipeline nunca
   * escribe `leads.nombre` —los crea con `""` y jamás copia el de Meta—, así
   * que este campo es del vendedor y no compite con nadie. No exige sesión
   * activa: el lead sigue existiendo después de que la sesión cierra.
   * NotFoundError si el lead no existe.
   */
  renombrarLead(input: RenombrarLeadServiceInput): Promise<Lead>;

  /**
   * Cuelga una etiqueta ya existente del lead, con `source: "manual"`.
   * Idempotente: reasignar la misma no pisa quién la puso ni cuándo.
   */
  asignarEtiqueta(input: EtiquetaLeadServiceInput): Promise<void>;

  /** Saca la etiqueta del lead. Quitar una que no estaba es no-op. */
  quitarEtiqueta(input: EtiquetaLeadServiceInput): Promise<void>;

  /**
   * Crea la etiqueta al vuelo y la cuelga del lead en un solo paso: el selector
   * del Twin la ofrece cuando el vendedor escribe un nombre que no existe.
   * ConflictError si ya hay una etiqueta con ese nombre (`tags.nombre` UNIQUE).
   */
  crearYAsignarEtiqueta(input: CrearEtiquetaServiceInput): Promise<Tag>;
}
