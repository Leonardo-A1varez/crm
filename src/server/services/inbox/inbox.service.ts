import type { ConversationView, InboxItem } from "@/types/inbox";
import type {
  CampoTwinEditable,
  Canal,
  EtapaEmbudo,
  MotivoPerdida,
  Resultado,
} from "@/types/domain";
import type { CampoContactoLead } from "@/lib/validation/inbox.schema";
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

/**
 * Plano y no la unión discriminada del repo (`ResolucionSesion`) a propósito:
 * así la obligatoriedad del motivo es una guarda de runtime que el service
 * puede comprobar y un test puede ejercitar. Con la unión acá, el `if` sería
 * inalcanzable y la regla viviría solo en el schema de entrada.
 */
export interface CloseSessionServiceInput {
  sessionId: UUID;
  resultado: Resultado;
  motivoPerdida: MotivoPerdida | null;
  /** Quién lo decidió: queda en `procedencia.current_stage`. */
  userId: UUID | null;
}

export interface EditarCampoTwinServiceInput {
  sessionId: UUID;
  campo: CampoTwinEditable;
  valor: string | number | null;
  userId: UUID | null;
}

export interface MoverEtapaServiceInput {
  sessionId: UUID;
  /** Solo las seis del embudo: los desvíos no se ponen a mano desde el rail. */
  etapa: EtapaEmbudo;
  userId: UUID | null;
}

export interface RenombrarLeadServiceInput {
  leadId: UUID;
  /** Vacío = el lead vuelve a "sin identificar"; no es un error. */
  nombre: string;
}

/**
 * Un dato cargado a mano desde el `+` de la ficha. Las dos formas son
 * excluyentes: o completa una columna que existe, o crea un campo libre.
 */
export type AgregarDatoLeadServiceInput = { leadId: UUID } & (
  | { tipo: "campo"; campo: CampoContactoLead; valor: string }
  | { tipo: "libre"; clave: string; valor: string }
);

/** El `×` de un campo libre. `clave` es el nombre tal como se ve en la ficha. */
export interface BorrarDatoExtraServiceInput {
  leadId: UUID;
  clave: string;
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
   * mensajes de la sesión ASC (cap 200) + canal activo.
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
   * Cierra la sesión con el resultado que decidió una persona y deja la etapa
   * que le corresponde: **ganado** la lleva a `cerrado` (paso 6 del embudo),
   * **perdido** a `perdido` (desvío, no paso 7). Ver `resolver` en el repo.
   *
   * `motivoPerdida` es obligatorio cuando `resultado` es `perdido`: sin él
   * lanza `ValidationError`. Un cierre perdido sin motivo es una fila que
   * después nadie puede explicar, y las viejas que ya están así son historia
   * que no se puede inventar hacia atrás.
   *
   * Replay idéntico es no-op; cierre con resultado distinto lanza
   * IllegalStateError; sesión inexistente, NotFoundError.
   */
  closeSession(input: CloseSessionServiceInput): Promise<LeadSession>;

  /**
   * Corrige a mano un campo del Twin y deja la marca de procedencia. Lanza
   * NotFoundError si la sesión no existe, ConflictError si está cerrada: una
   * ficha cerrada es historial y no se reescribe.
   */
  editarCampoTwin(input: EditarCampoTwinServiceInput): Promise<LeadSession>;

  /**
   * Mueve la etapa a mano desde el rail del Twin y deja la marca de
   * procedencia. Mismas guardas que `editarCampoTwin`: NotFoundError si la
   * sesión no existe, ConflictError si está cerrada.
   *
   * Retroceder es legítimo —una cotización que se cae vuelve a "identificando"—
   * y por eso no se valida el sentido del salto. Lo que no retrocede es
   * `etapa_alcanzada`: esa columna guarda el máximo y bajarla borraría el único
   * dato que existe para recordar hasta dónde llegó la conversación.
   */
  moverEtapa(input: MoverEtapaServiceInput): Promise<LeadSession>;

  /**
   * Pone el nombre con el que la casa identifica al lead. El pipeline nunca
   * escribe `leads.nombre` —los crea con `""` y jamás copia el de Meta—, así
   * que este campo es del vendedor y no compite con nadie. No exige sesión
   * activa: el lead sigue existiendo después de que la sesión cierra.
   * NotFoundError si el lead no existe.
   */
  renombrarLead(input: RenombrarLeadServiceInput): Promise<Lead>;

  /**
   * Carga un dato de contacto: o completa una columna existente, o agrega un
   * campo libre a `datos_extra`. Como `renombrarLead`, no exige sesión activa:
   * la dirección de un lead vale igual con la conversación cerrada.
   *
   * NotFoundError si el lead no existe; ValidationError si el campo libre
   * supera el tope de campos por lead.
   */
  agregarDato(input: AgregarDatoLeadServiceInput): Promise<Lead>;

  /**
   * Saca un campo libre de `datos_extra`. Es el único borrado de la ficha, y
   * llega hasta ahí: las columnas de contacto no se tocan ni por accidente
   * —la única escritura es el jsonb sin esa clave—, y para vaciar una columna
   * está la edición en el lugar.
   *
   * Borrar una clave que ya no está es no-op, como quitar una etiqueta que el
   * lead no tenía: la fila pudo desaparecer en otra pestaña.
   *
   * NotFoundError si el lead no existe.
   */
  borrarDatoExtra(input: BorrarDatoExtraServiceInput): Promise<Lead>;

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
