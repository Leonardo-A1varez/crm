import { z } from "zod";
import {
  CurrentStageSchema,
  MetodoPagoSchema,
  MotivoPerdidaSchema,
  ResultadoSchema,
  UrgenciaSchema,
} from "./schemas";

/**
 * El auto del que está hablando el cliente.
 *
 * Va anidado y no plano con el resto del patch porque **no vive en la sesión**:
 * los demás campos del Twin son de `lead_session`, el auto es del lead y vive en
 * `lead_vehiculos`. El service lo separa y lo escribe por otro repo.
 *
 * Sin esto el extractor no tenía por dónde guardarlo: el agente entendía
 * perfecto que le hablaban de un Aveo —se lo pasaba a `buscar_repuesto`— y el
 * Twin del Inbox seguía mostrando el lead sin ningún auto.
 *
 * Placa y VIN quedan afuera a propósito: son identificadores que alguien dicta y
 * se cargan a mano. Un modelo que alucina "AB123CD" ensucia la detección de
 * duplicados, que compara autos justamente por esos dos campos.
 */
export const VehiculoDetectadoSchema = z.object({
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  anio: z.number().int().nullable().optional(),
  motor: z.string().nullable().optional(),
});
export type VehiculoDetectado = z.infer<typeof VehiculoDetectadoSchema>;

export const LeadTwinUpdateSchema = z.object({
  vehiculo: VehiculoDetectadoSchema.optional(),
  current_stage: CurrentStageSchema.optional(),
  urgencia: UrgenciaSchema.optional(),
  consulta: z.string().optional(),
  codigo_interno: z.string().nullable().optional(),
  precio_cotizado: z.number().nullable().optional(),
  cantidad: z.number().int().nullable().optional(),
  bloqueador: z.string().nullable().optional(),
  comprobante_pago_url: z.string().url().nullable().optional(),
  metodo_pago: MetodoPagoSchema.nullable().optional(),
  resultado: ResultadoSchema.nullable().optional(),
  motivo_perdida: MotivoPerdidaSchema.nullable().optional(),
  // Catch-all extras LLM extrae. Shallow-merged en service (preserva keys previas).
  extras: z.record(z.string(), z.unknown()).optional(),
});
export type LeadTwinUpdate = z.infer<typeof LeadTwinUpdateSchema>;

export const BuscarRepuestoInputSchema = z.object({
  query: z.string().min(1).describe("Texto libre describe pieza buscada"),
  marca: z.string().optional().describe("Filtro marca vehículo"),
  modelo: z.string().optional().describe("Filtro modelo vehículo"),
  anio: z.number().int().optional().describe("Año vehículo"),
});
export type BuscarRepuestoInput = z.infer<typeof BuscarRepuestoInputSchema>;

export const BuscarRepuestoMatchSchema = z.object({
  id: z.string().uuid(),
  codigo_interno: z.string(),
  nombre: z.string(),
  precio: z.number().nonnegative(),
  stock: z.number().int().nonnegative(),
});
export type BuscarRepuestoMatch = z.infer<typeof BuscarRepuestoMatchSchema>;

export const BuscarRepuestoOutputSchema = z.object({
  matches: z.array(BuscarRepuestoMatchSchema),
  count: z.number().int().nonnegative(),
});
export type BuscarRepuestoOutput = z.infer<typeof BuscarRepuestoOutputSchema>;

export const IntentClassificationSchema = z.object({
  intent_nombre: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  razon: z.string().optional(),
});
export type IntentClassification = z.infer<typeof IntentClassificationSchema>;

export const HandoffDecisionSchema = z.object({
  pausar_ia: z.boolean(),
  motivo: z.string(),
});
export type HandoffDecision = z.infer<typeof HandoffDecisionSchema>;
