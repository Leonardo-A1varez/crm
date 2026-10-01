import { z } from "zod";
import { LARGO_MAXIMO_BORRADOR } from "@/lib/copiloto/limites";
import { UUIDSchema } from "@/lib/validation/schemas";
import { VIAS_USO_BORRADOR } from "@/types/copiloto";

// Inputs de las Server Actions del copiloto. Regla §0.9.3: parse en la línea 1.

/** `segun_horario` es `null` en la base; acá tiene nombre para que el cliente no mande `null`. */
export const CambiarModoRespuestaSchema = z.object({
  leadId: UUIDSchema,
  conversacionId: UUIDSchema,
  modo: z.enum(["segun_horario", "copiloto", "automatico"]),
});
export type CambiarModoRespuestaInput = z.infer<typeof CambiarModoRespuestaSchema>;

/** `texto` es el texto final (quizá editado en la tarjeta): es lo que queda en el hilo. */
export const UsarBorradorSchema = z.object({
  leadId: UUIDSchema,
  borradorId: UUIDSchema,
  via: z.enum(VIAS_USO_BORRADOR),
  texto: z.string().trim().min(1).max(LARGO_MAXIMO_BORRADOR),
});
export type UsarBorradorInput = z.infer<typeof UsarBorradorSchema>;

export const RegenerarBorradorSchema = z.object({
  leadId: UUIDSchema,
  borradorId: UUIDSchema,
});
export type RegenerarBorradorInput = z.infer<typeof RegenerarBorradorSchema>;
