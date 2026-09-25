import { z } from "zod";
import { CATEGORIA_PLANTILLA, MODO_AUDIENCIA } from "@/lib/difusion/modelo";
import { AudienciaSchema } from "./difusion.schema";
import { UUIDSchema } from "./schemas";

/**
 * Lo que aceptan las Server Actions de Difusión. Objetos estrictos: una clave
 * que no se conoce se rechaza en vez de descartarse —un `estado` colado en el
 * payload no puede llegar al servicio—.
 *
 * La forma del árbol la valida `AudienciaSchema`; que la audiencia se pueda
 * resolver (sin filas a medias, sin campos desconocidos, sin "toda la base"
 * implícita) lo decide `compilarAudiencia` en el servicio, porque un borrador
 * se guarda aunque esté a medio armar.
 */

/** El largo máximo del nombre. La pantalla lo usa como `maxLength` del campo. */
export const LARGO_MAXIMO_NOMBRE_DIFUSION = 120;

const NombreSchema = z
  .string()
  .trim()
  .min(1, "Poné un nombre a la difusión.")
  .max(
    LARGO_MAXIMO_NOMBRE_DIFUSION,
    `El nombre admite hasta ${LARGO_MAXIMO_NOMBRE_DIFUSION} caracteres.`,
  );

const audiencia = {
  audiencia: AudienciaSchema,
  todaLaBase: z.boolean(),
  modo: z.enum(MODO_AUDIENCIA),
  incluirEnNegociacion: z.boolean(),
  exentaTopeFrecuencia: z.boolean(),
};

export const CrearBorradorSchema = z.strictObject({ ...audiencia, nombre: NombreSchema });

export const GuardarBorradorSchema = z.strictObject({
  id: UUIDSchema,
  nombre: NombreSchema.optional(),
  audiencia: AudienciaSchema.optional(),
  todaLaBase: z.boolean().optional(),
  modo: z.enum(MODO_AUDIENCIA).optional(),
  incluirEnNegociacion: z.boolean().optional(),
  exentaTopeFrecuencia: z.boolean().optional(),
  plantilla: z
    .strictObject({
      nombre: z.string().trim().min(1).max(512),
      categoria: z.enum(CATEGORIA_PLANTILLA),
    })
    .nullable()
    .optional(),
});

export const CalcularAlcanceSchema = z.strictObject({
  ...audiencia,
  plantillaCategoria: z.enum(CATEGORIA_PLANTILLA).nullable(),
  muestra: z.strictObject({
    desde: z.number().int().min(0).max(1_000_000),
    limite: z.number().int().min(1).max(200),
  }),
  difusionId: UUIDSchema.nullable().optional(),
  conDiff: z.boolean().optional(),
});

export const ProgramarSchema = z.strictObject({
  id: UUIDSchema,
  canaryTamano: z.number().int().min(1).max(10_000).nullable(),
});

export const DifusionIdSchema = z.strictObject({ id: UUIDSchema });

export const DetenerSchema = z.strictObject({
  id: UUIDSchema,
  motivo: z.string().trim().min(1).max(500).optional(),
});
