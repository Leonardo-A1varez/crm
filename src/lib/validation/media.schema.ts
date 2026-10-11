import { z } from "zod";
import { CanalSchema, UUIDSchema } from "@/lib/validation/schemas";

// Inputs de las Server Actions de adjuntos (regla §0.8: parse en la línea 1).
// Los topes de tipo y tamaño NO viven acá sino en `validarAdjuntoSaliente`, que
// corre igual en el navegador y en el servidor; esto sólo cierra la forma.

/** `file.size` del navegador: un entero positivo. El tope real lo pone el service. */
const TamanoSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const PrepararAdjuntoSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  canal: CanalSchema,
  nombre: z.string().trim().min(1).max(255),
  mime: z.string().max(255),
  bytes: TamanoSchema,
});
export type PrepararAdjuntoInput = z.infer<typeof PrepararAdjuntoSchema>;

export const EnviarAdjuntoSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  canal: CanalSchema,
  /** La ruta que devolvió `prepararAdjunto`; el service la revalida entera. */
  ruta: z.string().min(1).max(200),
  nombre: z.string().trim().min(1).max(255),
  caption: z.string().max(1024).nullable(),
});
export type EnviarAdjuntoInput = z.infer<typeof EnviarAdjuntoSchema>;

/** El id del mensaje cuyo archivo se pide (`/api/media/[mensajeId]`). */
export const MediaMensajeParamsSchema = z.object({
  mensajeId: UUIDSchema,
});
