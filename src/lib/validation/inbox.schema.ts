import { z } from "zod";
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
