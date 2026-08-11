import type { AuditoriaTurno, ConversationView, InboxItem } from "@/types/inbox";
import type {
  CampoTwinEditable,
  Canal,
  EtapaEmbudo,
  MotivoPerdida,
  Resultado,
} from "@/types/domain";
import type { CampoContactoLead } from "@/lib/validation/inbox.schema";
import type { Lead, LeadSession, Mensaje, SessionRecordatorio, Tag, UUID } from "@/types/entities";
import type { EtiquetaOpcion } from "@/types/leads";

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

export interface ProgramarRecordatorioServiceInput {
  sessionId: UUID;
  /** Cuándo hay que volver. La validación de que es futuro vive en el schema. */
  recordarAt: Date;
  /** Puede venir vacía: la fecha sola ya es un recordatorio útil. */
  nota: string;
  userId: UUID | null;
}

export interface CancelarRecordatorioServiceInput {
  recordatorioId: UUID;
}

export interface ReprogramarRecordatorioServiceInput {
  recordatorioId: UUID;
  /** La fecha nueva. Que sea futura lo valida el schema, igual que al programar. */
  recordarAt: Date;
}

/**
 * Arranca el workflow durable que duerme hasta la fecha.
 *
 * Es una función inyectada y no una llamada directa a Inngest porque los
 * services no pueden importar `src/inngest/**` (boundaries), y porque así el
 * test del service comprueba *qué* se programó sin levantar un cliente. La
 * implementación real la arma `server/bootstrap/inbox-bootstrap.ts`.
 */
export type ProgramarAvisoRecordatorioFn = (input: {
  recordatorioId: UUID;
  leadSessionId: UUID;
  recordarAt: Date;
}) => Promise<void>;

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
   * Catálogo de etiquetas para el filtro del buscador del panel de lista.
   *
   * Se pide una vez al cargar el Inbox y no en cada búsqueda: el catálogo no
   * cambia mientras alguien tipea, y la mini-pantalla necesita sus opciones
   * pobladas ANTES de que se escriba la primera letra —un chip de filtro vacío
   * hasta que hay resultados no es un filtro—.
   */
  listEtiquetas(): Promise<EtiquetaOpcion[]>;

  /**
   * Vista conversación de un lead: lead + sesión activa (null si no hay) +
   * mensajes de la sesión ASC (cap 200) + canal activo.
   * Lanza NotFoundError cuando el lead no existe.
   */
  getConversation(leadId: UUID): Promise<ConversationView>;

  /**
   * Por qué el agente contestó ese mensaje saliente: regla o LLM, con qué
   * intent, qué herramientas llamó y qué costó.
   *
   * Se pide de a un turno y bajo demanda, no junto a `getConversation`: un hilo
   * de 200 mensajes son hasta 100 turnos, y traer la auditoría de todos para
   * que alguien mire uno serían cientos de filas de cuatro tablas por cada vez
   * que se abre una conversación.
   *
   * Nunca lanza por falta de datos. Un turno del que no hay registro devuelve
   * `sin_registro`, igual que hace el gasto del Twin: la respuesta honesta es
   * que no se midió, no un turno inventado.
   */
  getAuditoriaTurno(mensajeId: UUID): Promise<AuditoriaTurno>;

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

  /**
   * Programa el "volver a contactar en 2 días" sobre la sesión y arranca el
   * workflow que duerme hasta esa fecha.
   *
   * Uno vivo por sesión: si ya hay uno, `ConflictError`. Para cambiarle la
   * fecha está `reprogramarRecordatorio`, que no crea una segunda cita.
   *
   * `ConflictError` también si la sesión está cerrada: una cita sobre una
   * conversación que terminó no la va a ver nadie —el lead sale del Inbox— y a
   * los 29 días la purga se la lleva.
   */
  programarRecordatorio(input: ProgramarRecordatorioServiceInput): Promise<SessionRecordatorio>;

  /**
   * Apaga el recordatorio desde el Twin. Cancelar uno que ya no estaba vivo es
   * no-op y no error: pudo apagarlo otra pestaña, o el cliente pudo contestar
   * entre que se pintó la ficha y se hizo click.
   */
  cancelarRecordatorio(input: CancelarRecordatorioServiceInput): Promise<void>;

  /**
   * Le cambia la fecha al recordatorio vivo de la conversación, en un paso.
   *
   * La misma fila y el mismo id: cancelar y volver a programar dejaría un
   * hueco donde el índice único permite que entre otra cita, y le cambiaría el
   * id a algo que el vendedor percibe como la misma cosa.
   *
   * Arranca un workflow nuevo con la fecha nueva. El que ya estaba durmiendo
   * con la vieja se despierta igual y sale sin efecto: `marcarAvisado` compara
   * la fecha del evento contra la de la fila.
   *
   * `NotFoundError` si la fila no existe. `ConflictError` si ya no está viva
   * (la canceló otra pestaña, o el cliente contestó) o si la sesión se cerró.
   */
  reprogramarRecordatorio(input: ReprogramarRecordatorioServiceInput): Promise<SessionRecordatorio>;
}
