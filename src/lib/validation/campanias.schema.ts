import { z } from "zod";
import { UUIDSchema } from "@/lib/validation/schemas";

const FechaSchema = z.coerce.date();

export const CrearCampaniaSchema = z
  .object({
    nombre: z.string().trim().min(2, "Al menos 2 caracteres.").max(60, "Máximo 60 caracteres."),
    desde: FechaSchema,
    hasta: FechaSchema,
  })
  .refine((v) => v.hasta > v.desde, {
    message: "La fecha de fin tiene que ser posterior a la de inicio.",
    path: ["hasta"],
  });
export type CrearCampaniaInput = z.infer<typeof CrearCampaniaSchema>;

export const EditarCampaniaSchema = CrearCampaniaSchema.and(z.object({ id: UUIDSchema }));
export type EditarCampaniaInput = z.infer<typeof EditarCampaniaSchema>;

export const BorrarCampaniaSchema = z.object({ id: UUIDSchema });
export type BorrarCampaniaInput = z.infer<typeof BorrarCampaniaSchema>;
