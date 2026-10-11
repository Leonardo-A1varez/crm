import type { UUID } from "@/types/entities";

/**
 * Un número de WhatsApp conectado desde Ajustes con el registro insertado de
 * Meta. Espeja `public.whatsapp_numeros` (migración 20261011120000). El token
 * NO está acá: vive cifrado en otra tabla que sólo lee el backend.
 */
export const MODO_NUMERO = ["coexistencia", "cloud"] as const;
export type ModoNumero = (typeof MODO_NUMERO)[number];

export const ESTADO_NUMERO = ["conectado", "error", "desconectado"] as const;
export type EstadoNumero = (typeof ESTADO_NUMERO)[number];

export const ESTADO_HISTORIAL = [
  "pendiente",
  "pedido",
  "en_curso",
  "completo",
  "rechazado",
  "vencido",
  "error",
] as const;
export type EstadoHistorial = (typeof ESTADO_HISTORIAL)[number];

export interface WhatsAppNumero {
  id: UUID;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  modo: ModoNumero;
  estado: EstadoNumero;
  error: string | null;
  conectado_por: UUID | null;
  conectado_at: Date;
  is_on_biz_app: boolean | null;
  platform_type: string | null;
  verificado_at: Date | null;
  contactos_pedido_at: Date | null;
  contactos_sincronizados_at: Date | null;
  historial_pedido_at: Date | null;
  historial_estado: EstadoHistorial;
  historial_progreso: number | null;
}

/** Qué sincronización de `smb_app_data`: contactos o historial. */
export type Sincronizacion = "contactos" | "historial";
