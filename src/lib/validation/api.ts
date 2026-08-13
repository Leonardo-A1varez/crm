import { z } from "zod";
import {
  CanalSchema,
  CompatibilidadEntrySchema,
  MetaUserIdsSchema,
  TipoMensajeSchema,
  UUIDSchema,
} from "./schemas";

export const CreateLeadInputSchema = z.object({
  nombre: z.string().min(1),
  telefono: z.string().min(1),
  email: z.string().email().nullable().optional(),
  direccion: z.string().nullable().optional(),
  vehiculo_marca: z.string().nullable(),
  vehiculo_modelo: z.string().nullable(),
  vehiculo_anio: z.number().int().nullable(),
  vehiculo_motor: z.string().nullable().optional(),
  empresa_id: UUIDSchema.nullable().optional(),
  canal_origen: CanalSchema,
  meta_user_ids: MetaUserIdsSchema.optional(),
});
export type CreateLeadInput = z.infer<typeof CreateLeadInputSchema>;

export const UpdateLeadInputSchema = CreateLeadInputSchema.partial();
export type UpdateLeadInput = z.infer<typeof UpdateLeadInputSchema>;

export const PauseIAInputSchema = z.object({
  lead_session_id: UUIDSchema,
  paused: z.boolean(),
});
export type PauseIAInput = z.infer<typeof PauseIAInputSchema>;

export const MergeLeadsInputSchema = z.object({
  primary_lead_id: UUIDSchema,
  secondary_lead_id: UUIDSchema,
  channel_to_merge: CanalSchema,
});
export type MergeLeadsInput = z.infer<typeof MergeLeadsInputSchema>;

export const SendMessageInputSchema = z.object({
  conversacion_id: UUIDSchema,
  lead_session_id: UUIDSchema,
  tipo: TipoMensajeSchema.default("text"),
  contenido: z.string().min(1).optional(),
  media_url: z.string().url().optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const CreateProductoInputSchema = z.object({
  codigo_interno: z.string().min(1),
  sku_proveedor: z.string().nullable().optional(),
  nombre: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  categoria: z.string().nullable().optional(),
  compatibilidad: z.array(CompatibilidadEntrySchema).default([]),
  precio: z.number().nonnegative(),
  stock: z.number().int().nonnegative().default(0),
  imagen_url: z.string().url().nullable().optional(),
  activo: z.boolean().default(true),
});
export type CreateProductoInput = z.infer<typeof CreateProductoInputSchema>;

export const ImportProductosInputSchema = z.object({
  productos: z.array(CreateProductoInputSchema).min(1),
});
export type ImportProductosInput = z.infer<typeof ImportProductosInputSchema>;

export const AssignTagInputSchema = z.object({
  lead_id: UUIDSchema,
  tag_id: UUIDSchema,
});
export type AssignTagInput = z.infer<typeof AssignTagInputSchema>;

export const WebhookMetaSchema = z
  .object({
    object: z.string(),
    entry: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();
export type WebhookMetaPayload = z.infer<typeof WebhookMetaSchema>;
