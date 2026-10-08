import { z } from "zod";

/**
 * El contrato de lectura del catálogo de Bodega Web: la RPC
 * `public.crm_catalogo_cambios(p_clave, p_tabla, p_desde, p_despues, p_limite)`.
 *
 * Las formas salen del contrato del dueño (`crm_lectura_catalogo_contrato.md`, §2 y §5).
 * Los esquemas descartan lo que no conocen: un campo nuevo en Bodega Web no tumba la
 * sincronización, y a la base solo llega lo que este archivo declara.
 */

/** El orden recomendado por el contrato (§3): las bajas al final. */
export const TABLAS_BODEGA = ["marcas", "existencias", "variantes", "bajas"] as const;
export type TablaBodega = (typeof TABLAS_BODEGA)[number];

/** La posición de lectura de una tabla. Los dos campos son texto y se devuelven TAL CUAL. */
export interface CursorBodega {
  /** Texto UTC con microsegundos, o `-infinity` la primera vez. Nunca pasa por un `Date`. */
  desde: string;
  /** Opaco. `null` = «todo lo posterior a `desde`». */
  despues: string | null;
}

export const CURSOR_INICIAL: Readonly<CursorBodega> = Object.freeze({
  desde: "-infinity",
  despues: null,
});

/** Mismo cursor, comparado como texto (un `Date` redondea a milisegundos). */
export function mismoCursor(a: CursorBodega, b: CursorBodega): boolean {
  return a.desde === b.desde && a.despues === b.despues;
}

const texto = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

// `despues` es opaco y el contrato lo da como texto; un número se acepta por si un
// día lo manda así y se guarda como el texto que es.
const despues = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v)));

export const CursorBodegaSchema = z.object({
  desde: z.string().min(1),
  despues,
});

const fecha = z.string().min(1);
const fechaOpcional = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

export const FilaMarcaSchema = z.object({
  nombre: z.string(),
  tipo: texto,
  procedencia: texto,
  activa: z.boolean(),
  alias: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  actualizada_en: fecha,
});
export type FilaMarca = z.output<typeof FilaMarcaSchema>;

export const FilaExistenciaSchema = z.object({
  no_item: z.string(),
  grupo_numero: z
    .number()
    .int()
    .nullish()
    .transform((v) => v ?? null),
  origen: texto,
  actualizado_en: fecha,
});
export type FilaExistencia = z.output<typeof FilaExistenciaSchema>;

const ProveedorSchema = z
  .object({
    id: texto,
    nombre: texto,
    abreviatura: texto,
  })
  .nullish()
  .transform((v) => v ?? { id: null, nombre: null, abreviatura: null });

export const FilaVarianteSchema = z.object({
  id: z.string(),
  item_codigo_interno: z.string(),
  proveedor: ProveedorSchema,
  supplier_code_raw: texto,
  supplier_code_norm: texto,
  codigos_auxiliares: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  descripcion_raw: texto,
  descripcion_limpia: texto,
  descripcion_auxiliar: texto,
  marca_raw: texto,
  marca_canonica: texto,
  marca_id: texto,
  marca_procedencia: texto,
  lado: texto,
  categoria: texto,
  estado: z.string(),
  descartada: z.boolean(),
  promovida: z.boolean(),
  promovida_en: fechaOpcional,
  primera_vez: fechaOpcional,
  ultima_vez: fechaOpcional,
  actualizado_en: fecha,
});
export type FilaVariante = z.output<typeof FilaVarianteSchema>;

export const FilaBajaSchema = z.object({
  id: z.number().int(),
  // Texto libre a propósito: una tabla nueva en Bodega Web no puede frenar la
  // sincronización (la función SQL ignora las que no conoce).
  tabla: z.string(),
  clave: z.string(),
  borrado_en: fecha,
});
export type FilaBaja = z.output<typeof FilaBajaSchema>;

export interface FilaDeTabla {
  marcas: FilaMarca;
  existencias: FilaExistencia;
  variantes: FilaVariante;
  bajas: FilaBaja;
}

const ESQUEMA_DE_FILA = {
  marcas: FilaMarcaSchema,
  existencias: FilaExistenciaSchema,
  variantes: FilaVarianteSchema,
  bajas: FilaBajaSchema,
} as const;

export interface PaginaBodega<T extends TablaBodega = TablaBodega> {
  tabla: T;
  filas: FilaDeTabla[T][];
  /** La posición después de la última fila: lo que se guarda. */
  cursor: CursorBodega;
  /** No nulo cuando la página vino llena (puede haber más). */
  siguiente: CursorBodega | null;
}

const RespuestaBaseSchema = z.object({
  tabla: z.enum(TABLAS_BODEGA),
  filas: z.array(z.unknown()),
  cursor: CursorBodegaSchema,
  siguiente: CursorBodegaSchema.nullish().transform((v) => v ?? null),
});

/**
 * Valida una respuesta de `crm_catalogo_cambios` para la tabla pedida. Lanza
 * `z.ZodError` si no cumple el contrato; el cliente lo convierte en `ValidationError`.
 */
export function parsearPagina<T extends TablaBodega>(tabla: T, crudo: unknown): PaginaBodega<T> {
  const base = RespuestaBaseSchema.parse(crudo);
  if (base.tabla !== tabla) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["tabla"],
        message: `se pidió ${tabla} y Bodega Web devolvió ${base.tabla}`,
        input: base.tabla,
      },
    ]);
  }
  const esquema = ESQUEMA_DE_FILA[tabla] as unknown as z.ZodType<FilaDeTabla[T]>;
  const filas = z.array(esquema).parse(base.filas);
  return { tabla, filas, cursor: base.cursor, siguiente: base.siguiente };
}

/** La condición de «variante confiable» del contrato (§5): el CRM solo se fía de estas. */
export function esVarianteConfiable(v: {
  descartada: boolean;
  estado: string;
  activa?: boolean;
}): boolean {
  return (
    v.activa !== false && !v.descartada && (v.estado === "CONFIRMED" || v.estado === "TRUSTED")
  );
}

/**
 * Un sello ISO 8601 de Bodega Web como microsegundos desde la época, SIN perder los
 * microsegundos (`Date.parse` redondea a milisegundos). Sirve para comparar dos sellos
 * (la regla de las bajas); el cursor, en cambio, nunca se convierte: se guarda como texto.
 * `NaN` si no es un sello válido.
 */
export function selloEnMicros(iso: string): number {
  const m =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
      iso,
    );
  if (!m) return Number.NaN;
  const fraccion = (m[3] ?? "").padEnd(6, "0");
  let zona = m[4] ?? "Z";
  if (/^[+-]\d{2}$/.test(zona)) zona = `${zona}:00`;
  else if (/^[+-]\d{4}$/.test(zona)) zona = `${zona.slice(0, 3)}:${zona.slice(3)}`;
  const segundos = Date.parse(`${m[1]}T${m[2]}${zona}`);
  // ≈ 1,8·10^15 hoy: cabe en un double (límite 2^53 ≈ 9·10^15).
  return segundos * 1000 + Number(fraccion);
}
