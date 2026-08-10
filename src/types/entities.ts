import type {
  Canal,
  CurrentStage,
  Direction,
  EstadoEntrega,
  MergeCandidateStatus,
  MetodoPago,
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

/** Quién dejó el valor actual de un campo del Twin. */
export interface ProcedenciaCampo {
  por: "humano";
  at: string;
  user_id: UUID | null;
}

export type Procedencia = Record<string, ProcedenciaCampo>;

export interface MensajeMetadata {
  reply_to?: string;
  context?: Record<string, unknown>;
  raw?: Record<string, unknown>;
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
  nombre: string;
  telefono: string;
  email: string | null;
  direccion: string | null;
  vehiculo_marca: string;
  vehiculo_modelo: string;
  vehiculo_anio: number;
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
  extras: Record<string, unknown>;
  context_summary: string | null;
  /** Campos del Twin corregidos por una persona; ausente = lo puso el extractor. */
  procedencia: Procedencia;
  started_at: Date;
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
  /** Solo salientes. `null` mientras Meta no reporte el primer estado. */
  estado_entrega: EstadoEntrega | null;
  estado_entrega_at: Date | null;
  error_entrega: string | null;
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
