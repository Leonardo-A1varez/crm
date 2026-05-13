import { z } from "zod";
import {
  CurrentStageSchema,
  MetodoPagoSchema,
  MotivoPerdidaSchema,
  ResultadoSchema,
  UrgenciaSchema,
} from "./schemas";

export const LeadTwinUpdateSchema = z.object({
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
