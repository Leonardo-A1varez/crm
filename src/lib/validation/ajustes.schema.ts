import { z } from "zod";

/** Largo máximo del rol de un número. El mismo tope tiene la base. */
export const ROL_NUMERO_MAX = 40;

/**
 * Guardar el rol de un número de WhatsApp. `rol` vacío borra la etiqueta.
 *
 * `phoneNumberId` sólo dígitos: es el id de Meta, y cualquier otra cosa no es
 * un número de esta cuenta. `strict`: el actor sale de la sesión del server,
 * nunca del cliente.
 */
export const GuardarRolNumeroSchema = z
  .object({
    phoneNumberId: z.string().regex(/^\d{1,30}$/, "id de número inválido"),
    rol: z
      .string()
      .refine(
        (v) => v.trim().length <= ROL_NUMERO_MAX,
        `el rol no puede pasar de ${ROL_NUMERO_MAX} caracteres`,
      ),
  })
  .strict();

export type GuardarRolNumeroInput = z.infer<typeof GuardarRolNumeroSchema>;
