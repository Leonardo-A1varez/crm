import { z } from "zod";
import { TAG_COLOR_VALUES } from "@/lib/ui/tag-color";
import { emptyToNull } from "@/lib/validation/productos.schema";
import { UUIDSchema } from "@/lib/validation/schemas";

// Inputs de las Server Actions de /tags. Regla §0.9.3: parse en la línea 1.

/**
 * El nombre viaja a un badge de una línea: un salto de línea o un tab lo parten
 * y ensucian la fila de la tabla. La longitud tope es de la UI, no de la DB
 * (`tags.nombre` es `text`): más de 40 caracteres desborda el badge.
 */
export const TagNombreSchema = z
  .string()
  .trim()
  .min(2, "El nombre necesita al menos 2 caracteres.")
  .max(40, "El nombre no puede pasar de 40 caracteres.")
  .regex(/^[^\n\r\t]+$/, "El nombre no puede tener saltos de línea.");

/**
 * Enum y no el regex hex del CHECK de la tabla: el CHECK acepta cualquier
 * color de 6 dígitos, incluidos los que no se leen sobre el fondo oscuro.
 * La paleta es la garantía de legibilidad y tiene que valer también para quien
 * llame la action sin pasar por el formulario.
 */
export const TagColorSchema = z.enum(TAG_COLOR_VALUES);

export const CrearTagSchema = z.object({
  nombre: TagNombreSchema,
  color: TagColorSchema,
  descripcion: emptyToNull(200),
});
export type CrearTagInput = z.infer<typeof CrearTagSchema>;

export const EditarTagSchema = CrearTagSchema.extend({ id: UUIDSchema });
export type EditarTagInput = z.infer<typeof EditarTagSchema>;

export const BorrarTagSchema = z.object({ id: UUIDSchema });
export type BorrarTagInput = z.infer<typeof BorrarTagSchema>;
