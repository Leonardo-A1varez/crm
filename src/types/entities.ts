import type {
  Canal,
  CurrentStage,
  Direction,
  EstadoEntrega,
  EstadoRecordatorio,
  EtapaEmbudo,
  MergeCandidateStatus,
  MetodoPago,
  MotivoCancelacionRecordatorio,
  MotivoPerdida,
  RespuestaTipo,
  Resultado,
  RolUsuario,
  Sender,
  TagSource,
  TipoMensaje,
  Urgencia,
} from "./domain";

export type UUID = string;

export interface MetaUserIds {
  wa?: string;
  ig?: string;
  fb?: string;
}

export interface CompatibilidadEntry {
  marca: string;
  modelo: string;
  anio_desde: number;
  anio_hasta: number;
  motor?: string;
}

/** Quién escribió el valor actual de un campo del Twin. */
export type ProcedenciaPor = "ia" | "humano";

/**
 * De dónde salió el valor actual de un campo del Twin.
 *
 * Anota las dos manos, no solo la humana: el panel muestra debajo de cada campo
 * de qué mensaje se dedujo el dato y, cuando alguien lo corrigió, qué había
 * inferido el extractor antes. Sin la entrada de la IA esas dos líneas no se
 * pueden escribir.
 *
 * La ausencia de la clave significa que nadie escribió ese campo todavía — NO
 * que lo puso la IA, que es lo que significaba en el contrato viejo (ver
 * supabase/migrations/20260810150000).
 */
export interface ProcedenciaCampo {
  por: ProcedenciaPor;
  at: string;
  /** Solo en `por: "humano"`; el extractor no es un usuario. */
  user_id: UUID | null;
  /** Mensaje del que salió el dato. `null` cuando no se pudo atribuir. */
  mensaje_origen_id?: UUID | null;
  /** Lo que había en el campo antes de esta escritura. */
  valor_anterior?: string | number | null;
}

export type Procedencia = Record<string, ProcedenciaCampo>;

/**
 * Salientes que no los escribió ni el agente ni una persona: los produjo una
 * plantilla fija del pipeline. Hoy hay una sola.
 *
 * Existe para que la auditoría del turno pueda decir quién resolvió el turno en
 * vez de decir que no se midió: la plantilla de fuera de horario corta antes
 * del clasificador y del agente, así que no deja fila en ninguna de las cuatro
 * tablas de auditoría, pero se sabe perfectamente qué contestó.
 */
export const PLANTILLA_SALIENTE = ["fuera_horario", "handoff"] as const;
export type PlantillaSaliente = (typeof PLANTILLA_SALIENTE)[number];

export interface MensajeMetadata {
  reply_to?: string;
  context?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  /**
   * Marca del saliente producido por una plantilla. Ausente en todo lo demás,
   * incluidos los salientes anteriores a que esto se marcara: la auditoría de
   * esos sigue diciendo que no se midió, porque de esos no se sabe.
   */
  plantilla?: PlantillaSaliente;
  [k: string]: unknown;
}

export interface Empresa {
  id: UUID;
  nombre: string;
  ruc_nit: string | null;
  created_at: Date;
}

export interface Lead {
  id: UUID;
  /** Cómo identifica la casa al lead. Lo escribe el vendedor; nace vacío. */
  nombre: string;
  /**
   * Cómo se llama a sí mismo en la plataforma (WhatsApp `profile.name`). Lo
   * mantiene el pipeline y nunca pisa `nombre`. `null` en Instagram y Messenger,
   * que no lo mandan en el webhook.
   */
  nombre_perfil: string | null;
  telefono: string;
  email: string | null;
  direccion: string | null;
  /**
   * Campos libres que carga el vendedor desde el `+` de la ficha. Las claves
   * que colisionan con columnas reales se rechazan al escribir, para que no
   * haya dos fuentes del mismo dato.
   */
  datos_extra: Record<string, string>;
  vehiculo_marca: string | null;
  vehiculo_modelo: string | null;
  vehiculo_anio: number | null;
  vehiculo_motor: string | null;
  empresa_id: UUID | null;
  canal_origen: Canal;
  meta_user_ids: MetaUserIds;
  created_at: Date;
  updated_at: Date;
}

export interface LeadSession {
  id: UUID;
  lead_id: UUID;
  current_stage: CurrentStage;
  /**
   * Máximo paso del embudo por el que pasó la sesión. En un desvío
   * (`current_stage` = `perdido` / `requiere_humano`) el rail del Twin se
   * congela acá: `current_stage` ya no dice por dónde venía.
   */
  etapa_alcanzada: EtapaEmbudo;
  urgencia: Urgencia;
  consulta: string;
  producto_cotizado_id: UUID | null;
  codigo_interno: string | null;
  precio_cotizado: number | null;
  cantidad: number | null;
  bloqueador: string | null;
  comprobante_pago_url: string | null;
  metodo_pago: MetodoPago | null;
  resultado: Resultado | null;
  motivo_perdida: MotivoPerdida | null;
  ia_pausada: boolean;
  /** Etapa de negocio previa al desvío administrativo; ausente en fixtures legacy. */
  stage_before_handoff?: CurrentStage | null;
  extras: Record<string, unknown>;
  context_summary: string | null;
  /** Quién escribió cada campo del Twin; ausente = nadie lo escribió todavía. */
  procedencia: Procedencia;
  started_at: Date;
  /** Último cambio de la ficha (trigger en DB). Alimenta el "hace X" del Twin. */
  updated_at: Date;
  closed_at: Date | null;
}

export interface Producto {
  id: UUID;
  codigo_interno: string;
  sku_proveedor: string | null;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  compatibilidad: CompatibilidadEntry[];
  precio: number;
  stock: number;
  imagen_url: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Conversacion {
  id: UUID;
  lead_id: UUID;
  canal: Canal;
  canal_thread_id: string;
  ultima_actividad_at: Date;
}

export interface Mensaje {
  id: UUID;
  conversacion_id: UUID;
  lead_session_id: UUID;
  direction: Direction;
  sender: Sender;
  sender_user_id: UUID | null;
  tipo: TipoMensaje;
  contenido: string | null;
  media_url: string | null;
  meta_message_id: string | null;
  idempotency_key: string | null;
  metadata: MensajeMetadata;
  created_at: Date;
  /** Hora informada por Meta para entrantes; null en datos históricos/salientes. */
  platform_created_at?: Date | null;
  /** Solo salientes. `null` mientras Meta no reporte el primer estado. */
  estado_entrega: EstadoEntrega | null;
  estado_entrega_at: Date | null;
  error_entrega: string | null;
}

export interface HandoffEvent {
  id: UUID;
  lead_session_id: UUID;
  action: "pause" | "resume";
  reason_code:
    | "unknown_intents"
    | "sensitive_keyword"
    | "quote_limit"
    | "discount_limit"
    | "rule_handoff"
    | "manual_pause"
    | "manual_resume"
    | "other";
  source: "auto_handoff" | "agent_guard" | "rule" | "pipeline_guard" | "admin";
  previous_stage: CurrentStage | null;
  actor_user_id: UUID | null;
  source_event_key: string;
  created_at: Date;
}

export interface Intent {
  id: UUID;
  nombre: string;
  descripcion: string;
  ejemplos: string[];
  auto_detectado: boolean;
  activo: boolean;
}

export interface Regla {
  id: UUID;
  intent_id: UUID;
  condiciones_extra: Record<string, unknown> | null;
  respuesta_tipo: RespuestaTipo;
  respuesta_contenido: string;
  prioridad: number;
  activa: boolean;
  created_at: Date;
}

export interface RuleExecution {
  id: UUID;
  regla_id: UUID;
  mensaje_id: UUID;
  matched_intent_id: UUID;
  created_at: Date;
}

/**
 * La otra mitad de `RuleExecution`: el turno que ninguna regla cubrió y
 * terminó contestando el LLM. Se cuelga del mensaje entrante que lo disparó,
 * igual que la auditoría de reglas.
 */
export interface TurnClassification {
  id: UUID;
  mensaje_id: UUID;
  /** `null` si el clasificador no reconoció ningún intent activo. */
  intent_id: UUID | null;
  /** Nombre tal como se clasificó; sobrevive al rename o borrado del intent. */
  intent_nombre: string | null;
  confidence: number;
  created_at: Date;
}

export interface Tag {
  id: UUID;
  nombre: string;
  color: string;
  descripcion: string | null;
}

export interface LeadTag {
  lead_id: UUID;
  tag_id: UUID;
  source: TagSource;
  assigned_by: UUID | null;
  assigned_at: Date;
}

export interface Usuario {
  id: UUID;
  nombre: string;
  email: string;
  rol: RolUsuario;
  activo: boolean;
  created_at: Date;
}

export interface ToolExecution {
  id: UUID;
  lead_session_id: UUID;
  mensaje_id: UUID | null;
  tool_name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  duration_ms: number | null;
  created_at: Date;
}

/**
 * Una llamada al modelo, con lo que costó. Append-only.
 *
 * `lead_session_id` y `mensaje_id` son nulables por dos motivos distintos: hay
 * llamadas que no nacen de una conversación (el detector batch de intents, el
 * preview de la consola), y la purga de sesiones a los 29 días pone el FK en
 * NULL en vez de arrastrarse la fila — el gasto sobrevive a la conversación.
 */
export interface LlmUsage {
  id: UUID;
  lead_session_id: UUID | null;
  mensaje_id: UUID | null;
  /** Modelo tal como se facturó; texto y no enum para sobrevivir a la lista blanca. */
  modelo: string;
  input_tokens: number;
  output_tokens: number;
  costo_usd: number;
  /** "ai-agent", "intent-classifier", "twin-extractor", "agente-preview", … */
  workflow: string;
  created_at: Date;
}

export interface AdminAction {
  id: UUID;
  actor_user_id: UUID | null;
  action: string;
  entity_type: string;
  entity_id: UUID | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

export interface MergeCandidate {
  id: UUID;
  src_lead_id: UUID;
  dst_lead_id: UUID;
  similarity_score: number;
  reasons: string[];
  status: MergeCandidateStatus;
  resolved_by: UUID | null;
  resolved_at: Date | null;
  created_at: Date;
}

export type ReactivationDispatchStatus = "sent" | "failed" | "bounced";

export interface ReactivationDispatch {
  id: UUID;
  lead_session_id: UUID;
  motivo: MotivoPerdida | null;
  template_name: string;
  meta_message_id: string | null;
  status: ReactivationDispatchStatus;
  created_at: Date;
}

/**
 * "Volver a contactar en 2 días": una cita que el vendedor se pone sobre una
 * conversación que quedó en el aire.
 *
 * Cuelga de la sesión y no del lead: el recordatorio nace de algo que se dijo
 * en *esta* conversación ("lo pienso"), y cuando la sesión cierra deja de tener
 * sentido — por eso la FK va con CASCADE.
 */
export interface SessionRecordatorio {
  id: UUID;
  lead_session_id: UUID;
  /** Cuándo hay que volver. Es la fecha a la que duerme el workflow. */
  recordar_at: Date;
  /**
   * La línea que el vendedor va a leer cuando esto se dispare. Puede tener
   * datos del cliente: nunca se loguea, ni siquiera en un warn.
   */
  nota: string;
  estado: EstadoRecordatorio;
  /** Solo con `estado` en `cancelado`. */
  motivo_cancelacion: MotivoCancelacionRecordatorio | null;
  /** Quién lo puso. `null` si el usuario se dio de baja. */
  creado_por: UUID | null;
  created_at: Date;
  avisado_at: Date | null;
  cancelado_at: Date | null;
}

export type OutboxEventStatus = "pending" | "sent" | "failed";

export interface EventOutboxRow {
  id: UUID;
  event_name: string;
  event_data: Record<string, unknown>;
  event_id: string | null;
  status: OutboxEventStatus;
  attempts: number;
  last_error: string | null;
  scheduled_at: Date;
  sent_at: Date | null;
  created_at: Date;
}
