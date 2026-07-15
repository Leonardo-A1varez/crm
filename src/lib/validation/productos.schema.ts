import { z } from "zod";
import { UUIDSchema } from "@/lib/validation/schemas";

// Inputs Server Actions productos (Slice 2 fase 9). Regla §0.9.3: parse línea 1.

/**
 * Texto opcional de forms/CSV: "" o whitespace → null. undefined también → null
 * (columna opcional ausente en CSV).
 */
export const emptyToNull = (max: number) =>
  z.preprocess(
    (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
    z.string().trim().min(1).max(max).nullable(),
  );

export const CreateProductoSchema = z.object({
  codigo_interno: z.string().trim().min(1).max(64),
  nombre: z.string().trim().min(1).max(200),
  descripcion: emptyToNull(1000),
  categoria: emptyToNull(100),
  sku_proveedor: emptyToNull(100),
  precio: z.number().nonnegative().finite().max(9_999_999_999.99),
  stock: z.number().int().nonnegative().max(2_147_483_647),
});
export type CreateProductoInput = z.infer<typeof CreateProductoSchema>;

export const UpdateProductoSchema = CreateProductoSchema.omit({ codigo_interno: true }).extend({
  id: UUIDSchema,
});
export type UpdateProductoInput = z.infer<typeof UpdateProductoSchema>;

export const SetProductoActivoSchema = z.object({
  id: UUIDSchema,
  activo: z.boolean(),
});
export type SetProductoActivoInput = z.infer<typeof SetProductoActivoSchema>;

// Celdas numéricas CSV llegan como string. "" → undefined para que el campo
// requerido falle claro (Number("") === 0 sería un 0 silencioso — bug de datos).
const csvNumberCell = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Fila CSV import catálogo. Headers ya normalizados (trim + lowercase). */
export const CsvProductoRowSchema = z.object({
  codigo_interno: z.string().trim().min(1).max(64),
  nombre: z.string().trim().min(1).max(200),
  descripcion: emptyToNull(1000),
  categoria: emptyToNull(100),
  sku_proveedor: emptyToNull(100),
  precio: z.preprocess(
    csvNumberCell,
    z.coerce.number().nonnegative().finite().max(9_999_999_999.99),
  ),
  stock: z.preprocess(csvNumberCell, z.coerce.number().int().nonnegative().max(2_147_483_647)),
});
