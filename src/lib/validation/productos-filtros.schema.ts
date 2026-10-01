import { z } from "zod";
import {
  COLUMNAS_LISTA,
  DEFINICIONES_LISTA,
  leerNiveles,
  type ClaveLista,
  type NivelOrden,
} from "@/lib/catalogo/columnas-productos";
import { normalizarValor } from "@/lib/catalogo/normalizar-valor";
import { ValidationError } from "@/lib/errors";

// Filtros, orden y lotes de /productos. Los parámetros llegan de la URL como
// strings (o string[] si la clave se repite) y también pueden llegar ya tipados
// desde código: el schema acepta las dos formas. Regla §0.9.3: se parsea en la
// primera línea del service, antes de armar nada para el SQL.

export {
  SIN_CATEGORIA,
  SIN_CODIGO_FABRICA,
  SIN_DESCRIPCION,
  SIN_MARCA,
  SIN_OTROS_CODIGOS,
} from "@/lib/catalogo/columnas-productos";

/** Cuántas filas trae cada lote de la carga completa. */
export const LOTE_TAMANO = 1000;
/** Lote más alto aceptado: acota el `offset` que se le manda a Postgres (10 millones de filas). */
export const LOTE_MAX = 10_000;
export const TEXTO_MAX = 100;
export const LISTA_MAX = 300;
/** Largo máximo de un valor de lista; `descripcion` admite 1000 en el alta. */
export const VALOR_LISTA_MAX = 1000;

const PRECIO_MAX = 9_999_999_999.99;
const STOCK_MAX = 2_147_483_647;

/** "" / en blanco / ausente → undefined. */
function vacioAUndefined(v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") {
    const t = normalizarValor(v);
    return t === "" ? undefined : t;
  }
  return v;
}

const texto = z.preprocess(vacioAUndefined, z.string().max(TEXTO_MAX).optional());

/** Número que puede venir como string de la URL. `Number("")` sería un 0 silencioso. */
function numero(max: number, entero: boolean) {
  let base = z.number().finite().nonnegative().max(max);
  if (entero) base = base.int();
  return z.preprocess((v) => {
    const x = vacioAUndefined(v);
    return typeof x === "string" ? Number(x) : x;
  }, base.optional());
}

const entero = (min: number, max: number, def: number) =>
  z.preprocess((v) => {
    const x = vacioAUndefined(v);
    return typeof x === "string" ? Number(x) : x;
  }, z.number().int().min(min).max(max).default(def));

const booleano = z.preprocess((v) => {
  const x = vacioAUndefined(v);
  if (x === undefined) return null;
  if (x === "1" || x === "true") return true;
  if (x === "0" || x === "false") return false;
  return x;
}, z.boolean().nullable());

/** Un valor suelto o repetido → array; sin vacíos ni duplicados. */
const lista = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return [];
    const crudo = Array.isArray(v) ? v : [v];
    const vistos = new Set<string>();
    const out: unknown[] = [];
    for (const item of crudo) {
      if (typeof item !== "string") {
        out.push(item);
        continue;
      }
      const t = normalizarValor(item);
      if (t === "" || vistos.has(t)) continue;
      vistos.add(t);
      out.push(t);
    }
    return out;
  },
  z.array(z.string().max(VALOR_LISTA_MAX)).max(LISTA_MAX),
);

const estado = z.preprocess(
  (v) => vacioAUndefined(v) ?? null,
  z.enum(["activo", "inactivo"]).nullable(),
);

/** Lo que llega de `orden` y `dir`: strings repetidos, o niveles ya armados desde código. */
const ordenCrudo = z.unknown().optional();

const ProductosFiltrosBase = z.object({
  /** Buscador general: código interno, de fábrica, alternos, descripción y marca. */
  q: texto,
  codigos: lista,
  sinCodigos: lista,
  codigosFabrica: lista,
  sinCodigosFabrica: lista,
  otrosCodigos: lista,
  sinOtrosCodigos: lista,
  categorias: lista,
  sinCategorias: lista,
  descripciones: lista,
  sinDescripciones: lista,
  marcas: lista,
  sinMarcas: lista,
  precioMin: numero(PRECIO_MAX, false),
  precioMax: numero(PRECIO_MAX, false),
  stockMin: numero(STOCK_MAX, true),
  stockMax: numero(STOCK_MAX, true),
  conStock: booleano,
  estado,
  orden: ordenCrudo,
  dir: ordenCrudo,
});

function comoLista(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * `orden` puede ser `["marca", "precio"]` con `dir` en paralelo (la URL), o ya los
 * niveles `[{ campo, dir }]` (código). Un nivel mal formado se descarta.
 */
function nivelesDeEntrada(orden: unknown, dir: unknown): NivelOrden[] {
  const ordenes = comoLista(orden);
  const dirs = comoLista(dir);
  return leerNiveles(
    ordenes.map((o) =>
      typeof o === "object" && o !== null ? (o as { campo?: unknown }).campo : o,
    ),
    ordenes.map((o, i) =>
      typeof o === "object" && o !== null ? (o as { dir?: unknown }).dir : dirs[i],
    ),
  );
}

export const ProductosFiltrosSchema = ProductosFiltrosBase.superRefine((f, ctx) => {
  // Incluir y excluir en la misma columna no tiene un significado único.
  for (const columna of COLUMNAS_LISTA) {
    const d = DEFINICIONES_LISTA[columna];
    if (f[d.incluir].length > 0 && f[d.excluir].length > 0) {
      ctx.addIssue({
        code: "custom",
        path: [d.incluir],
        message: `${d.incluir} y ${d.excluir} no se pueden usar juntas`,
      });
    }
  }
  if (f.precioMin !== undefined && f.precioMax !== undefined && f.precioMin > f.precioMax) {
    ctx.addIssue({
      code: "custom",
      path: ["precioMin"],
      message: "precioMin no puede ser mayor que precioMax",
    });
  }
  if (f.stockMin !== undefined && f.stockMax !== undefined && f.stockMin > f.stockMax) {
    ctx.addIssue({
      code: "custom",
      path: ["stockMin"],
      message: "stockMin no puede ser mayor que stockMax",
    });
  }
}).transform(({ orden, dir, ...resto }) => ({
  ...resto,
  /** Los niveles que alguien eligió; vacío es "el orden por defecto". Nunca más de tres. */
  orden: nivelesDeEntrada(orden, dir),
}));

export type ProductosFiltros = z.output<typeof ProductosFiltrosSchema>;
export type EstadoProducto = NonNullable<ProductosFiltros["estado"]>;

/**
 * Lo que acepta `parseProductosFiltros`: la forma de `searchParams` de Next
 * (string, string[] o ausente) o los mismos campos ya tipados.
 */
export type ProductosFiltrosEntrada = {
  /**
   * Buscador general, plegado y "contiene", sobre `codigo_interno`,
   * `codigo_fabrica`, `otros_codigos`, `nombre` y la marca. En blanco = sin filtro.
   */
  q?: string;
  /** Incluir es "solo estos"; excluir, "todos menos estos". Excluyentes por columna. */
  precioMin?: string | number;
  precioMax?: string | number;
  stockMin?: string | number;
  stockMax?: string | number;
  conStock?: string | boolean | null;
  estado?: string | null;
  /** `orden=campo` repetido con `dir` en paralelo, o niveles ya armados. */
  orden?: string | string[] | readonly NivelOrden[];
  dir?: string | string[];
} & { [K in ClaveLista]?: string | string[] };

/**
 * Valida y normaliza. Tira `ValidationError` con el campo y el motivo; las
 * claves que el schema no conoce se descartan (también las de la paginación de
 * antes: `pagina`, `porPagina`).
 */
export function parseProductosFiltros(raw: unknown): ProductosFiltros {
  const r = ProductosFiltrosSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  const detalle = r.error.issues
    .map((i) => `${i.path.join(".") || "filtros"}: ${i.message}`)
    .join("; ");
  throw new ValidationError(`filtros de productos inválidos (${detalle})`, r.error.issues);
}

// ---------------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------------

const LoteSchema = entero(1, LOTE_MAX, 1);

/** El número de lote (1-based) de `?lote=`. Sin valor es el primero. */
export function parseLote(raw: unknown): number {
  const r = LoteSchema.safeParse(raw);
  if (r.success) return r.data;
  throw new ValidationError("lote de productos inválido", r.error.issues);
}

// ---------------------------------------------------------------------------
// Opciones de una lista de valores: no viajan en la URL, son estado del panel.
// ---------------------------------------------------------------------------

export const LIMITE_FACETA_DEFAULT = 500;
export const LIMITE_FACETA_MAX = 3000;

export const OpcionesFacetaSchema = z.object({
  /** Qué lista calcular. */
  columna: z.enum(COLUMNAS_LISTA),
  /** Búsqueda dentro de la lista, antes del límite. Exacta en los identificadores. */
  q: texto,
  limite: z.number().int().min(1).max(LIMITE_FACETA_MAX).default(LIMITE_FACETA_DEFAULT),
});

export type OpcionesFaceta = z.output<typeof OpcionesFacetaSchema>;

/** Entrada de `facetaProductos`. */
export interface OpcionesFacetaEntrada {
  columna: string;
  q?: string;
  /** Tope de valores: entero entre 1 y 3000. Por defecto 500. */
  limite?: number;
}

export function parseOpcionesFaceta(raw: unknown): OpcionesFaceta {
  const r = OpcionesFacetaSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  const detalle = r.error.issues
    .map((i) => `${i.path.join(".") || "opciones"}: ${i.message}`)
    .join("; ");
  throw new ValidationError(`opciones de lista inválidas (${detalle})`, r.error.issues);
}
