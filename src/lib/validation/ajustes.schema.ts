import { z } from "zod";
import { esEmpresaErp } from "@/lib/catalogo/precios-erp";
import type { EmpresaErp } from "@/types/entities";

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

/**
 * Asignar la empresa del ERP de un usuario (la columna de precio que se le
 * resalta en /productos). `empresaErp` llega como número, o como texto desde un
 * `<select>`; vacío o `null` la quita. Solo 1, 3, 5 y 6. `strict`: el actor sale
 * de la sesión del server, nunca del cliente.
 */
export const AsignarEmpresaErpSchema = z
  .object({
    usuarioId: z.string().uuid("usuario inválido"),
    empresaErp: z
      .union([z.number(), z.string(), z.null()])
      .transform((v) => (v === null || v === "" ? null : Number(v)))
      .refine((v) => v === null || esEmpresaErp(v), "empresa del ERP inválida")
      .transform((v) => v as EmpresaErp | null),
  })
  .strict();

export type AsignarEmpresaErpInput = z.infer<typeof AsignarEmpresaErpSchema>;
