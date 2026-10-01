import { z } from "zod";
import { ValidationError } from "@/lib/errors";

// Filtros y paginación de /productos. Los parámetros llegan de la URL como
// strings (o string[] si la clave se repite) y también pueden llegar ya
// tipados desde código: el schema acepta las dos formas. Regla §0.9.3: se
// parsea en la primera línea del service, antes de armar nada para el SQL.

export const POR_PAGINA_DEFAULT = 50;
export const POR_PAGINA_MAX = 100;
/** Página más alta aceptada: acota el `offset` que se le manda a Postgres. */
export const PAGINA_MAX = 100_000;
export const TEXTO_MAX = 100;
export const LISTA_MAX = 300;
/** Largo máximo de un valor de lista; `descripcion` admite 1000 en el alta. */
export const VALOR_LISTA_MAX = 1000;
/**
 * Valor especial de `marcas` para los productos sin marca (`descripcion` nula
 * o en blanco). Un producto cuya marca real fuera literalmente este texto
 * quedaría mezclado con los sin marca; no existe hoy en el catálogo.
 */
export const SIN_MARCA = "(sin marca)";

const PRECIO_MAX = 9_999_999_999.99;
const STOCK_MAX = 2_147_483_647;

/** "" / en blanco / ausente → undefined. */
function vacioAUndefined(v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") {
    const t = v.trim();
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
      const t = item.trim();
      if (t === "" || vistos.has(t)) continue;
      vistos.add(t);
      out.push(t);
    }
    return out;
  },
  z.array(z.string().max(VALOR_LISTA_MAX)).max(LISTA_MAX),
);

const modoTexto = z.preprocess(
  (v) => vacioAUndefined(v),
  z.enum(["contiene", "empieza"]).default("contiene"),
);

const estado = z.preprocess(
  (v) => vacioAUndefined(v) ?? null,
  z.enum(["activo", "inactivo"]).nullable(),
);

export const ProductosFiltrosSchema = z
  .object({
    codigo: texto,
    codigoModo: modoTexto,
    descripcion: texto,
    descripcionModo: modoTexto,
    categorias: lista,
    marcas: lista,
    precioMin: numero(PRECIO_MAX, false),
    precioMax: numero(PRECIO_MAX, false),
    stockMin: numero(STOCK_MAX, true),
    stockMax: numero(STOCK_MAX, true),
    conStock: booleano,
    estado,
    pagina: entero(1, PAGINA_MAX, 1),
    porPagina: entero(1, POR_PAGINA_MAX, POR_PAGINA_DEFAULT),
  })
  .superRefine((f, ctx) => {
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
  });

export type ProductosFiltros = z.output<typeof ProductosFiltrosSchema>;
export type ModoTexto = ProductosFiltros["codigoModo"];
export type EstadoProducto = NonNullable<ProductosFiltros["estado"]>;

/**
 * Lo que acepta `parseProductosFiltros`: la forma de `searchParams` de Next
 * (string, string[] o ausente) o los mismos campos ya tipados.
 */
export interface ProductosFiltrosEntrada {
  codigo?: string;
  codigoModo?: string;
  descripcion?: string;
  descripcionModo?: string;
  categorias?: string | string[];
  marcas?: string | string[];
  precioMin?: string | number;
  precioMax?: string | number;
  stockMin?: string | number;
  stockMax?: string | number;
  conStock?: string | boolean | null;
  estado?: string | null;
  pagina?: string | number;
  porPagina?: string | number;
}

/**
 * Valida y normaliza. Tira `ValidationError` con el campo y el motivo; las
 * claves que el schema no conoce se descartan.
 */
export function parseProductosFiltros(raw: unknown): ProductosFiltros {
  const r = ProductosFiltrosSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  const detalle = r.error.issues
    .map((i) => `${i.path.join(".") || "filtros"}: ${i.message}`)
    .join("; ");
  throw new ValidationError(`filtros de productos inválidos (${detalle})`, r.error.issues);
}
