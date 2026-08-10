import { z } from "zod";
import { CAMPOS_TWIN_EDITABLES } from "@/types/domain";
import {
  CanalSchema,
  MotivoPerdidaSchema,
  ResultadoSchema,
  UUIDSchema,
} from "@/lib/validation/schemas";

// Inputs de Server Actions inbox (Slice 2 8.4-8.5). Regla §0.9.3: parse línea 1.

// 4096 = límite WhatsApp text; IG/FB toleran menos pero Meta trunca, no rechaza.
export const SendMessageSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  canal: CanalSchema,
  body: z.string().trim().min(1).max(4096),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const ToggleHandoffSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  action: z.enum(["pause", "resume"]),
});
export type ToggleHandoffInput = z.infer<typeof ToggleHandoffSchema>;

export const CloseSessionSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  resultado: ResultadoSchema,
  motivoPerdida: MotivoPerdidaSchema.optional(),
});
export type CloseSessionInput = z.infer<typeof CloseSessionSchema>;

// El campo se valida contra la lista blanca del repo: sin esto, un cliente
// podría mandar `ia_pausada` o `resultado` y saltearse las reglas que los
// gobiernan. `valor` acepta texto, número o vacío — vacío borra el dato.
export const EditarCampoTwinSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  campo: z.enum(CAMPOS_TWIN_EDITABLES),
  valor: z.union([z.string().trim().max(2000), z.number(), z.null()]),
});
export type EditarCampoTwinInput = z.infer<typeof EditarCampoTwinSchema>;

/**
 * El nombre con el que la casa identifica al lead. Acepta vacío porque volver a
 * dejarlo sin nombre tiene que ser posible: el pipeline crea los leads con `""`
 * y ese vacío es el estado legítimo de "todavía nadie lo identificó".
 */
export const RenombrarLeadSchema = z.object({
  leadId: UUIDSchema,
  nombre: z.string().trim().max(80),
});
export type RenombrarLeadInput = z.infer<typeof RenombrarLeadSchema>;

export const AsignarEtiquetaSchema = z.object({
  leadId: UUIDSchema,
  tagId: UUIDSchema,
});
export type AsignarEtiquetaInput = z.infer<typeof AsignarEtiquetaSchema>;

export const QuitarEtiquetaSchema = z.object({
  leadId: UUIDSchema,
  tagId: UUIDSchema,
});
export type QuitarEtiquetaInput = z.infer<typeof QuitarEtiquetaSchema>;

// 40 chars: el chip vive en un panel de 322px y un nombre más largo deja de
// leerse como etiqueta. `nombre` es UNIQUE en la tabla, así que el duplicado lo
// resuelve el repo con ConflictError y no la validación.
export const CrearEtiquetaSchema = z.object({
  leadId: UUIDSchema,
  nombre: z.string().trim().min(1).max(40),
});
export type CrearEtiquetaInput = z.infer<typeof CrearEtiquetaSchema>;
