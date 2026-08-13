import { z } from "zod";
import {
  CANAL,
  CURRENT_STAGE,
  DIRECTION,
  MERGE_CANDIDATE_STATUS,
  METODO_PAGO,
  MOTIVO_PERDIDA,
  RESPUESTA_TIPO,
  RESULTADO,
  ROL_USUARIO,
  SENDER,
  TAG_SOURCE,
  TIPO_MENSAJE,
  URGENCIA,
} from "@/types/domain";

export const UUIDSchema = z.string().uuid();

export const CanalSchema = z.enum(CANAL);
export const CurrentStageSchema = z.enum(CURRENT_STAGE);
export const DirectionSchema = z.enum(DIRECTION);
export const MetodoPagoSchema = z.enum(METODO_PAGO);
export const MotivoPerdidaSchema = z.enum(MOTIVO_PERDIDA);
export const RespuestaTipoSchema = z.enum(RESPUESTA_TIPO);
export const ResultadoSchema = z.enum(RESULTADO);
export const RolUsuarioSchema = z.enum(ROL_USUARIO);
export const SenderSchema = z.enum(SENDER);
export const TagSourceSchema = z.enum(TAG_SOURCE);
export const TipoMensajeSchema = z.enum(TIPO_MENSAJE);
export const UrgenciaSchema = z.enum(URGENCIA);
export const MergeCandidateStatusSchema = z.enum(MERGE_CANDIDATE_STATUS);

export const MetaUserIdsSchema = z.object({
  wa: z.string().optional(),
  ig: z.string().optional(),
  fb: z.string().optional(),
});

export const CompatibilidadEntrySchema = z.object({
  marca: z.string().min(1),
  modelo: z.string().min(1),
  anio_desde: z.number().int().min(1900).max(2100),
  anio_hasta: z.number().int().min(1900).max(2100),
  motor: z.string().optional(),
});

export const MensajeMetadataSchema = z
  .object({
    reply_to: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    raw: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown());

export const EmpresaSchema = z.object({
  id: UUIDSchema,
  nombre: z.string().min(1),
  ruc_nit: z.string().nullable(),
  created_at: z.date(),
});

export const LeadSchema = z.object({
  id: UUIDSchema,
  nombre: z.string().min(1),
  telefono: z.string().min(1),
  email: z.string().email().nullable(),
  direccion: z.string().nullable(),
  vehiculo_marca: z.string().nullable(),
  vehiculo_modelo: z.string().nullable(),
  vehiculo_anio: z.number().int().nullable(),
  vehiculo_motor: z.string().nullable(),
  empresa_id: UUIDSchema.nullable(),
  canal_origen: CanalSchema,
  meta_user_ids: MetaUserIdsSchema,
  created_at: z.date(),
  updated_at: z.date(),
});

export const LeadSessionSchema = z.object({
  id: UUIDSchema,
  lead_id: UUIDSchema,
  current_stage: CurrentStageSchema,
  urgencia: UrgenciaSchema,
  consulta: z.string(),
  producto_cotizado_id: UUIDSchema.nullable(),
  codigo_interno: z.string().nullable(),
  precio_cotizado: z.number().nullable(),
  cantidad: z.number().int().nullable(),
  bloqueador: z.string().nullable(),
  comprobante_pago_url: z.string().url().nullable(),
  metodo_pago: MetodoPagoSchema.nullable(),
  resultado: ResultadoSchema.nullable(),
  motivo_perdida: MotivoPerdidaSchema.nullable(),
  ia_pausada: z.boolean(),
  extras: z.record(z.string(), z.unknown()),
  context_summary: z.string().nullable(),
  started_at: z.date(),
  closed_at: z.date().nullable(),
});

export const ProductoSchema = z.object({
  id: UUIDSchema,
  codigo_interno: z.string().min(1),
  sku_proveedor: z.string().nullable(),
  nombre: z.string().min(1),
  descripcion: z.string().nullable(),
  categoria: z.string().nullable(),
  compatibilidad: z.array(CompatibilidadEntrySchema),
  precio: z.number().nonnegative(),
  stock: z.number().int().nonnegative(),
  imagen_url: z.string().url().nullable(),
  activo: z.boolean(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const ConversacionSchema = z.object({
  id: UUIDSchema,
  lead_id: UUIDSchema,
  canal: CanalSchema,
  canal_thread_id: z.string(),
  ultima_actividad_at: z.date(),
});

export const MensajeSchema = z.object({
  id: UUIDSchema,
  conversacion_id: UUIDSchema,
  lead_session_id: UUIDSchema,
  direction: DirectionSchema,
  sender: SenderSchema,
  sender_user_id: UUIDSchema.nullable(),
  tipo: TipoMensajeSchema,
  contenido: z.string().nullable(),
  media_url: z.string().url().nullable(),
  meta_message_id: z.string().nullable(),
  idempotency_key: z.string().nullable(),
  metadata: MensajeMetadataSchema,
  created_at: z.date(),
});

export const IntentSchema = z.object({
  id: UUIDSchema,
  nombre: z.string().min(1),
  descripcion: z.string(),
  ejemplos: z.array(z.string()),
  auto_detectado: z.boolean(),
  activo: z.boolean(),
});

export const ReglaSchema = z.object({
  id: UUIDSchema,
  intent_id: UUIDSchema,
  condiciones_extra: z.record(z.string(), z.unknown()).nullable(),
  respuesta_tipo: RespuestaTipoSchema,
  respuesta_contenido: z.string(),
  prioridad: z.number().int(),
  activa: z.boolean(),
  created_at: z.date(),
});

export const RuleExecutionSchema = z.object({
  id: UUIDSchema,
  regla_id: UUIDSchema,
  mensaje_id: UUIDSchema,
  matched_intent_id: UUIDSchema,
  created_at: z.date(),
});

export const TagSchema = z.object({
  id: UUIDSchema,
  nombre: z.string().min(1),
  color: z.string(),
  descripcion: z.string().nullable(),
});

export const LeadTagSchema = z.object({
  lead_id: UUIDSchema,
  tag_id: UUIDSchema,
  source: TagSourceSchema,
  assigned_by: UUIDSchema.nullable(),
  assigned_at: z.date(),
});

export const UsuarioSchema = z.object({
  id: UUIDSchema,
  nombre: z.string().min(1),
  email: z.string().email(),
  rol: RolUsuarioSchema,
  activo: z.boolean(),
  created_at: z.date(),
});

export const ToolExecutionSchema = z.object({
  id: UUIDSchema,
  lead_session_id: UUIDSchema,
  mensaje_id: UUIDSchema.nullable(),
  tool_name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  created_at: z.date(),
});

export const AdminActionSchema = z.object({
  id: UUIDSchema,
  actor_user_id: UUIDSchema.nullable(),
  action: z.string().min(1),
  entity_type: z.string().min(1),
  entity_id: UUIDSchema.nullable(),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.date(),
});

export const MergeCandidateSchema = z.object({
  id: UUIDSchema,
  src_lead_id: UUIDSchema,
  dst_lead_id: UUIDSchema,
  similarity_score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  status: MergeCandidateStatusSchema,
  resolved_by: UUIDSchema.nullable(),
  resolved_at: z.date().nullable(),
  created_at: z.date(),
});
