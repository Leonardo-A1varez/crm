import {
  LISTA_MAX,
  POR_PAGINA_DEFAULT,
  POR_PAGINA_MAX,
  SIN_CATEGORIA,
  SIN_MARCA,
  TEXTO_MAX,
} from "@/lib/validation/productos-filtros.schema";
import type { Resolucion } from "@/lib/ui/seleccion-faceta";

/**
 * Los filtros de `/productos` viven en la URL y nada más.
 *
 * Este módulo es el único traductor entre la URL y los controles: lee los
 * `searchParams` de forma tolerante (la validación estricta es del service, que
 * tira `ValidationError`), arma la URL nueva al aplicar o limpiar un filtro y
 * escribe el resumen que se ve en los chips. Los nombres de clave son los del
 * schema del backend (`productos-filtros.schema.ts`): si el service acepta
 * `?sinMarcas=…`, acá es la misma cadena.
 *
 * Es puro y no importa React: se prueba sin DOM.
 */

/** Lo mismo que Next entrega en `searchParams`, o lo que sale de `URLSearchParams`. */
export type ParamsEntrada = Record<string, string | string[] | undefined> | URLSearchParams;

/** Cada filtro que se puede poner o quitar por separado. */
export type GrupoFiltro =
  | "busqueda"
  | "codigo"
  | "descripcion"
  | "marca"
  | "categoria"
  | "precio"
  | "stock"
  | "estado";

/** Las claves de URL que escribe cada filtro. Se ponen y se sacan juntas. */
export const CLAVES_GRUPO: Record<GrupoFiltro, readonly string[]> = {
  busqueda: ["q"],
  codigo: ["codigo", "codigoModo"],
  descripcion: ["descripcion", "descripcionModo"],
  marca: ["marcas", "sinMarcas"],
  categoria: ["categorias", "sinCategorias"],
  precio: ["precioMin", "precioMax"],
  stock: ["stockMin", "stockMax", "conStock"],
  estado: ["estado"],
};

export const GRUPOS: readonly GrupoFiltro[] = [
  "busqueda",
  "codigo",
  "descripcion",
  "marca",
  "categoria",
  "precio",
  "stock",
  "estado",
];

export type ModoTextoUrl = "contiene" | "empieza";
export type ConStockUrl = "1" | "0" | null;
export type EstadoUrl = "activo" | "inactivo" | null;

/** Lo que la URL dice hoy, sin validar: es lo que los controles muestran. */
export interface FiltrosUrl {
  /** Buscador general. */
  q: string;
  codigo: string;
  codigoModo: ModoTextoUrl;
  descripcion: string;
  descripcionModo: ModoTextoUrl;
  categorias: string[];
  sinCategorias: string[];
  marcas: string[];
  sinMarcas: string[];
  precioMin: string;
  precioMax: string;
  stockMin: string;
  stockMax: string;
  conStock: ConStockUrl;
  estado: EstadoUrl;
  pagina: number;
  porPagina: number;
}

const PAGINA_CLAVE = "pagina";
const POR_PAGINA_CLAVE = "porPagina";

function todos(params: ParamsEntrada, clave: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(clave);
  const v = params[clave];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function primero(params: ParamsEntrada, clave: string): string {
  return (todos(params, clave)[0] ?? "").trim();
}

function modo(v: string): ModoTextoUrl {
  return v === "empieza" ? "empieza" : "contiene";
}

function enteroPositivo(v: string, def: number, max: number): number {
  const n = Number(v);
  return v !== "" && Number.isInteger(n) && n >= 1 ? Math.min(n, max) : def;
}

/**
 * Lee los filtros de la URL. Nunca tira: un valor que no se entiende cae al
 * neutro, y el service es quien decide si la combinación es válida.
 */
export function leerFiltros(params: ParamsEntrada): FiltrosUrl {
  const conStock = primero(params, "conStock");
  const estado = primero(params, "estado");
  return {
    q: primero(params, "q"),
    codigo: primero(params, "codigo"),
    codigoModo: modo(primero(params, "codigoModo")),
    descripcion: primero(params, "descripcion"),
    descripcionModo: modo(primero(params, "descripcionModo")),
    categorias: todos(params, "categorias").filter((v) => v !== ""),
    sinCategorias: todos(params, "sinCategorias").filter((v) => v !== ""),
    marcas: todos(params, "marcas").filter((v) => v !== ""),
    sinMarcas: todos(params, "sinMarcas").filter((v) => v !== ""),
    precioMin: primero(params, "precioMin"),
    precioMax: primero(params, "precioMax"),
    stockMin: primero(params, "stockMin"),
    stockMax: primero(params, "stockMax"),
    conStock: conStock === "1" || conStock === "0" ? conStock : null,
    estado: estado === "activo" || estado === "inactivo" ? estado : null,
    pagina: enteroPositivo(primero(params, PAGINA_CLAVE), 1, 100_000),
    porPagina: enteroPositivo(
      primero(params, POR_PAGINA_CLAVE),
      POR_PAGINA_DEFAULT,
      POR_PAGINA_MAX,
    ),
  };
}

/** El `searchParams` de Next (clave repetida = array) como `URLSearchParams`. */
export function aUrlSearchParams(entrada: ParamsEntrada): URLSearchParams {
  if (entrada instanceof URLSearchParams) return new URLSearchParams(entrada);
  const out = new URLSearchParams();
  for (const [clave, valor] of Object.entries(entrada)) {
    if (valor === undefined) continue;
    for (const item of Array.isArray(valor) ? valor : [valor]) out.append(clave, item);
  }
  return out;
}

/** `true` si el filtro tiene algo puesto en la URL. */
export function grupoActivo(f: FiltrosUrl, g: GrupoFiltro): boolean {
  switch (g) {
    case "busqueda":
      return f.q !== "";
    case "codigo":
      return f.codigo !== "";
    case "descripcion":
      return f.descripcion !== "";
    case "marca":
      return f.marcas.length > 0 || f.sinMarcas.length > 0;
    case "categoria":
      return f.categorias.length > 0 || f.sinCategorias.length > 0;
    case "precio":
      return f.precioMin !== "" || f.precioMax !== "";
    case "stock":
      return f.stockMin !== "" || f.stockMax !== "" || f.conStock !== null;
    case "estado":
      return f.estado !== null;
  }
}

export function gruposActivos(f: FiltrosUrl): GrupoFiltro[] {
  return GRUPOS.filter((g) => grupoActivo(f, g));
}

export function hayFiltros(f: FiltrosUrl): boolean {
  return gruposActivos(f).length > 0;
}

// ---------------------------------------------------------------------------
// Escribir la URL
// ---------------------------------------------------------------------------

/** Valores nuevos de un filtro: clave → texto, o lista (clave repetida). */
export type ValoresGrupo = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * URL nueva con los filtros `grupos` reemplazados por `valores`.
 *
 * Cambiar un filtro vuelve a la página 1: la página 7 del resultado anterior
 * no significa nada en el nuevo. `porPagina` y los filtros que no se tocan se
 * conservan. Una clave sin valor (o con lista vacía) queda fuera de la URL, que
 * es como se limpia un filtro.
 */
export function aplicarGrupos(
  actual: URLSearchParams | string,
  grupos: readonly GrupoFiltro[],
  valores: ValoresGrupo,
): URLSearchParams {
  const params = new URLSearchParams(actual);
  for (const g of grupos) for (const clave of CLAVES_GRUPO[g]) params.delete(clave);
  for (const [clave, valor] of Object.entries(valores)) {
    if (valor === undefined) continue;
    if (typeof valor === "string") {
      if (valor !== "") params.set(clave, valor);
    } else {
      for (const item of valor) params.append(clave, item);
    }
  }
  params.delete(PAGINA_CLAVE);
  return params;
}

export function limpiarGrupos(
  actual: URLSearchParams | string,
  grupos: readonly GrupoFiltro[],
): URLSearchParams {
  return aplicarGrupos(actual, grupos, {});
}

export function limpiarTodo(actual: URLSearchParams | string): URLSearchParams {
  return limpiarGrupos(actual, GRUPOS);
}

/** `/ruta` o `/ruta?x=y`, sin `?` suelto. */
export function hrefCon(pathname: string, params: URLSearchParams): string {
  const q = params.toString();
  return q === "" ? pathname : `${pathname}?${q}`;
}

/** URL con otra página. La 1 se escribe sin `pagina` para que el link base quede limpio. */
export function conPagina(actual: URLSearchParams | string, pagina: number): URLSearchParams {
  const params = new URLSearchParams(actual);
  if (pagina <= 1) params.delete(PAGINA_CLAVE);
  else params.set(PAGINA_CLAVE, String(pagina));
  return params;
}

/**
 * Los filtros como los espera `facetasProductos`: sin `pagina` ni `porPagina`,
 * que las facetas ignoran. Una clave repetida llega como lista.
 */
export function filtrosParaFacetas(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const clave of GRUPOS.flatMap((g) => CLAVES_GRUPO[g])) {
    const valores = params.getAll(clave);
    if (valores.length === 0) continue;
    out[clave] = valores.length === 1 ? (valores[0] as string) : valores;
  }
  return out;
}

/**
 * Lo que una lista de filtro escribe en la URL, o `null` si lo que hay marcado
 * no se puede aplicar (nada marcado, o más valores de los que admite el tope).
 * "Sin filtro" devuelve un objeto vacío: aplicarlo limpia la columna.
 */
export function valoresDeLista(
  res: Resolucion,
  claveIncluir: string,
  claveExcluir: string,
): ValoresGrupo | null {
  switch (res.tipo) {
    case "sin-filtro":
      return {};
    case "incluir":
      return { [claveIncluir]: res.valores };
    case "excluir":
      return { [claveExcluir]: res.valores };
    case "ninguno":
    case "demasiados":
      return null;
  }
}

/** Por qué una lista no se puede aplicar, dicho en la lista; `null` si se puede. */
export function avisoDeLista(res: Resolucion, plural: string): string | null {
  if (res.tipo === "ninguno") return `Marcá al menos un valor de ${plural}.`;
  if (res.tipo === "demasiados")
    return `Marcaste demasiados valores: el filtro admite hasta ${LISTA_MAX} por lista. Buscá y marcá solo los que necesitás.`;
  return null;
}

// ---------------------------------------------------------------------------
// Resumen para los chips
// ---------------------------------------------------------------------------

export interface ResumenFiltro {
  grupo: GrupoFiltro;
  /** Lo que dice el chip. */
  texto: string;
}

const numeroFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

function num(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? numeroFmt.format(n) : v;
}

/** Nombre legible de un valor de lista: los comodines del backend en palabras. */
export function valorLegible(valor: string): string {
  if (valor === SIN_MARCA) return "sin marca";
  if (valor === SIN_CATEGORIA) return "sin categoría";
  return valor;
}

function listaCorta(valores: readonly string[]): string {
  const legibles = valores.map(valorLegible);
  return legibles.length <= 2 ? legibles.join(", ") : `${legibles.length} valores`;
}

function textoLista(
  etiqueta: string,
  plural: string,
  incluir: readonly string[],
  excluir: readonly string[],
): string {
  if (incluir.length > 0) return `${etiqueta}: ${listaCorta(incluir)}`;
  const menos = excluir.length <= 2 ? listaCorta(excluir) : `${excluir.length} ${plural}`;
  return `${etiqueta}: todas menos ${menos}`;
}

function textoRango(etiqueta: string, min: string, max: string, extra: string[] = []): string {
  const partes = [...extra];
  if (min !== "" && max !== "") partes.push(`${num(min)} a ${num(max)}`);
  else if (min !== "") partes.push(`desde ${num(min)}`);
  else if (max !== "") partes.push(`hasta ${num(max)}`);
  return `${etiqueta}: ${partes.join(", ")}`;
}

/** Un renglón por filtro puesto, en el orden de las columnas. */
export function resumirFiltros(f: FiltrosUrl): ResumenFiltro[] {
  const out: ResumenFiltro[] = [];
  if (f.q !== "") out.push({ grupo: "busqueda", texto: `Búsqueda: “${f.q}”` });
  const modoTxt = (m: ModoTextoUrl) => (m === "empieza" ? "empieza con" : "contiene");
  if (f.codigo !== "")
    out.push({ grupo: "codigo", texto: `Código ${modoTxt(f.codigoModo)} “${f.codigo}”` });
  if (f.descripcion !== "")
    out.push({
      grupo: "descripcion",
      texto: `Descripción ${modoTxt(f.descripcionModo)} “${f.descripcion}”`,
    });
  if (grupoActivo(f, "marca"))
    out.push({ grupo: "marca", texto: textoLista("Marca", "marcas", f.marcas, f.sinMarcas) });
  if (grupoActivo(f, "categoria"))
    out.push({
      grupo: "categoria",
      texto: textoLista("Categoría", "categorías", f.categorias, f.sinCategorias),
    });
  if (grupoActivo(f, "precio"))
    out.push({ grupo: "precio", texto: textoRango("Precio", f.precioMin, f.precioMax) });
  if (grupoActivo(f, "stock")) {
    const extra = f.conStock === "1" ? ["con stock"] : f.conStock === "0" ? ["sin stock"] : [];
    out.push({ grupo: "stock", texto: textoRango("Stock", f.stockMin, f.stockMax, extra) });
  }
  if (f.estado !== null)
    out.push({
      grupo: "estado",
      texto: `Estado: ${f.estado === "activo" ? "Activo" : "Inactivo"}`,
    });
  return out;
}

// ---------------------------------------------------------------------------
// Validar lo que se escribe en un control, antes de ir a la URL
// ---------------------------------------------------------------------------

/**
 * Error de un par mínimo/máximo, o `null` si está bien. Lo que el service
 * rechazaría con `ValidationError` se frena acá, en el campo, antes de navegar.
 */
export function errorDeRango(
  min: string,
  max: string,
  opciones: { entero: boolean; nombre: string },
): string | null {
  const partes: [string, string][] = [
    ["mínimo", min],
    ["máximo", max],
  ];
  for (const [lado, v] of partes) {
    if (v.trim() === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0)
      return `El ${lado} de ${opciones.nombre} tiene que ser un número desde 0.`;
    if (opciones.entero && !Number.isInteger(n))
      return `El ${lado} de ${opciones.nombre} tiene que ser un número entero.`;
  }
  if (min.trim() !== "" && max.trim() !== "" && Number(min) > Number(max)) {
    return `El mínimo de ${opciones.nombre} no puede ser mayor que el máximo.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Paginación
// ---------------------------------------------------------------------------

export interface RangoPagina {
  totalPaginas: number;
  /** 1-based; 0 si no hay resultados. */
  desde: number;
  hasta: number;
}

export function rangoDePagina(total: number, pagina: number, porPagina: number): RangoPagina {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  if (total === 0) return { totalPaginas, desde: 0, hasta: 0 };
  const desde = (pagina - 1) * porPagina + 1;
  return { totalPaginas, desde, hasta: Math.min(total, pagina * porPagina) };
}

// ---------------------------------------------------------------------------
// Mensajes cuando el service rechaza los filtros
// ---------------------------------------------------------------------------

const NOMBRE_CLAVE: Record<string, string> = {
  codigo: "Código",
  descripcion: "Descripción",
  categorias: "Categoría",
  sinCategorias: "Categoría",
  marcas: "Marca",
  sinMarcas: "Marca",
  precioMin: "Precio",
  precioMax: "Precio",
  stockMin: "Stock",
  stockMax: "Stock",
  conStock: "Stock",
  estado: "Estado",
  pagina: "Página",
  porPagina: "Página",
};

interface IssueCrudo {
  path?: unknown;
  code?: unknown;
  message?: unknown;
}

function esIssue(x: unknown): x is IssueCrudo {
  return typeof x === "object" && x !== null;
}

/**
 * Explica en castellano qué filtro de la URL no se pudo aplicar. Recibe los
 * `issues` de `ValidationError` (los de Zod); cualquier forma que no reconoce
 * cae en un mensaje genérico que igual dice cómo salir.
 */
export function mensajesDeFiltrosInvalidos(issues: unknown): string[] {
  const out = new Set<string>();
  const lista = Array.isArray(issues) ? issues : [];
  for (const crudo of lista) {
    if (!esIssue(crudo)) continue;
    const path = Array.isArray(crudo.path) ? crudo.path : [];
    const clave = String(path[0] ?? "");
    const nombre = NOMBRE_CLAVE[clave] ?? "Filtros";
    const mensaje = typeof crudo.message === "string" ? crudo.message : "";
    if (clave === "precioMin" || clave === "stockMin") {
      if (mensaje.includes("mayor")) {
        out.add(`El mínimo de ${nombre.toLowerCase()} no puede ser mayor que el máximo.`);
        continue;
      }
    }
    if (["marcas", "categorias"].includes(clave) && mensaje.includes("no se pueden usar juntas")) {
      out.add(
        `${nombre}: la URL incluye y excluye valores a la vez. Quitá el filtro y volvé a elegir.`,
      );
      continue;
    }
    if (["marcas", "sinMarcas", "categorias", "sinCategorias"].includes(clave)) {
      out.add(
        `${nombre}: hay más de ${LISTA_MAX} valores elegidos. Usá la búsqueda de la lista para acotar.`,
      );
      continue;
    }
    if (clave === "codigo" || clave === "descripcion") {
      out.add(`${nombre}: el texto admite hasta ${TEXTO_MAX} caracteres.`);
      continue;
    }
    if (["precioMin", "precioMax", "stockMin", "stockMax"].includes(clave)) {
      out.add(`${nombre}: ingresá un número válido, desde 0.`);
      continue;
    }
    if (clave === "pagina" || clave === "porPagina") {
      out.add("La página pedida no es válida.");
      continue;
    }
    out.add("Hay filtros en la URL que no son válidos.");
  }
  if (out.size === 0) out.add("Hay filtros en la URL que no son válidos.");
  return [...out];
}
