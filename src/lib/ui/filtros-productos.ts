import {
  COLUMNAS_LISTA,
  DEFINICIONES_LISTA,
  leerNiveles,
  VALORES_VACIOS,
  type ColumnaLista,
  type NivelOrden,
} from "@/lib/catalogo/columnas-productos";
import { normalizarValor } from "@/lib/catalogo/normalizar-valor";
import { LISTA_MAX, TEXTO_MAX } from "@/lib/validation/productos-filtros.schema";
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
export type GrupoFiltro = "busqueda" | ColumnaLista | "precio" | "stock" | "estado";

/** Las claves de URL que escribe cada filtro. Se ponen y se sacan juntas. */
export const CLAVES_GRUPO: Record<GrupoFiltro, readonly string[]> = {
  busqueda: ["q"],
  codigo: [DEFINICIONES_LISTA.codigo.incluir, DEFINICIONES_LISTA.codigo.excluir],
  codigoFabrica: [
    DEFINICIONES_LISTA.codigoFabrica.incluir,
    DEFINICIONES_LISTA.codigoFabrica.excluir,
  ],
  otrosCodigos: [DEFINICIONES_LISTA.otrosCodigos.incluir, DEFINICIONES_LISTA.otrosCodigos.excluir],
  categoria: [DEFINICIONES_LISTA.categoria.incluir, DEFINICIONES_LISTA.categoria.excluir],
  descripcion: [DEFINICIONES_LISTA.descripcion.incluir, DEFINICIONES_LISTA.descripcion.excluir],
  marca: [DEFINICIONES_LISTA.marca.incluir, DEFINICIONES_LISTA.marca.excluir],
  precio: ["precioMin", "precioMax"],
  stock: ["stockMin", "stockMax", "conStock"],
  estado: ["estado"],
};

/** Los filtros en el orden en que se ven los chips: el buscador y después las columnas. */
export const GRUPOS: readonly GrupoFiltro[] = [
  "busqueda",
  ...COLUMNAS_LISTA,
  "precio",
  "stock",
  "estado",
];

/** Parámetros de la paginación de antes: ya no existen y se sacan de la URL si quedaron. */
const CLAVES_OBSOLETAS = ["pagina", "porPagina"] as const;

export type ConStockUrl = "1" | "0" | null;
export type EstadoUrl = "activo" | "inactivo" | null;

export interface ListaUrl {
  incluir: string[];
  excluir: string[];
}

/** Lo que la URL dice hoy, sin validar: es lo que los controles muestran. */
export interface FiltrosUrl {
  /** Buscador general. */
  q: string;
  listas: Record<ColumnaLista, ListaUrl>;
  precioMin: string;
  precioMax: string;
  stockMin: string;
  stockMax: string;
  conStock: ConStockUrl;
  estado: EstadoUrl;
  /** Los niveles de orden elegidos; vacío es el orden por defecto. */
  orden: NivelOrden[];
}

function todos(params: ParamsEntrada, clave: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(clave);
  const v = params[clave];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function primero(params: ParamsEntrada, clave: string): string {
  return normalizarValor(todos(params, clave)[0] ?? "");
}

/** Los niveles de orden de la URL, validados contra la lista de campos. */
export function leerOrden(params: ParamsEntrada): NivelOrden[] {
  return leerNiveles(todos(params, "orden"), todos(params, "dir"));
}

/**
 * Lee los filtros de la URL. Nunca tira: un valor que no se entiende cae al
 * neutro, y el service es quien decide si la combinación es válida.
 */
export function leerFiltros(params: ParamsEntrada): FiltrosUrl {
  const conStock = primero(params, "conStock");
  const estado = primero(params, "estado");
  const listas = Object.fromEntries(
    COLUMNAS_LISTA.map((c) => {
      const d = DEFINICIONES_LISTA[c];
      return [
        c,
        {
          incluir: todos(params, d.incluir).filter((v) => v !== ""),
          excluir: todos(params, d.excluir).filter((v) => v !== ""),
        },
      ];
    }),
  ) as Record<ColumnaLista, ListaUrl>;
  return {
    q: primero(params, "q"),
    listas,
    precioMin: primero(params, "precioMin"),
    precioMax: primero(params, "precioMax"),
    stockMin: primero(params, "stockMin"),
    stockMax: primero(params, "stockMax"),
    conStock: conStock === "1" || conStock === "0" ? conStock : null,
    estado: estado === "activo" || estado === "inactivo" ? estado : null,
    orden: leerOrden(params),
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

function esColumna(g: GrupoFiltro): g is ColumnaLista {
  return g in DEFINICIONES_LISTA;
}

/** `true` si el filtro tiene algo puesto en la URL. */
export function grupoActivo(f: FiltrosUrl, g: GrupoFiltro): boolean {
  if (esColumna(g)) return f.listas[g].incluir.length > 0 || f.listas[g].excluir.length > 0;
  switch (g) {
    case "busqueda":
      return f.q !== "";
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
 * El orden y los filtros que no se tocan se conservan. Una clave sin valor (o con
 * lista vacía) queda fuera de la URL, que es como se limpia un filtro.
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
  for (const clave of CLAVES_OBSOLETAS) params.delete(clave);
  return params;
}

export function limpiarGrupos(
  actual: URLSearchParams | string,
  grupos: readonly GrupoFiltro[],
): URLSearchParams {
  return aplicarGrupos(actual, grupos, {});
}

/** Saca todos los filtros. El orden no es un filtro y se queda. */
export function limpiarTodo(actual: URLSearchParams | string): URLSearchParams {
  return limpiarGrupos(actual, GRUPOS);
}

/** `/ruta` o `/ruta?x=y`, sin `?` suelto. */
export function hrefCon(pathname: string, params: URLSearchParams): string {
  const q = params.toString();
  return q === "" ? pathname : `${pathname}?${q}`;
}

// ---------------------------------------------------------------------------
// La consulta que viaja a la API
// ---------------------------------------------------------------------------

const CLAVES_LISTA_SET: ReadonlySet<string> = new Set(
  COLUMNAS_LISTA.flatMap((c) => [DEFINICIONES_LISTA[c].incluir, DEFINICIONES_LISTA[c].excluir]),
);

/** Las claves que definen QUÉ filas hay (todas menos el orden), en un orden fijo. */
const CLAVES_FILTRO: readonly string[] = GRUPOS.flatMap((g) => CLAVES_GRUPO[g]);

/**
 * La URL reducida a lo que de verdad define el conjunto de filas: la búsqueda, los
 * filtros de columna y el orden.
 *
 * Hace dos trabajos con una sola cuerda: es lo que viaja al endpoint (ni más ni menos
 * que lo que la consulta necesita) y es la señal de reset de la carga completa — en
 * cuanto cambia se aborta la lectura anterior y se empieza de nuevo. Por eso es
 * canónica: claves en orden fijo, valores de lista ordenados, sin vacíos ni claves
 * desconocidas. Dos URLs que significan lo mismo dan el mismo texto y no disparan un
 * reset de mentira. Los niveles de orden conservan su orden (el primero manda).
 *
 * `sinOrden` la deja sin el orden (las listas de valores no dependen de él) y
 * `sinColumna` sin los filtros de esa columna (su lista los ignora): así una lista
 * abierta no se vuelve a pedir cuando lo único que cambió es lo que ella misma marcó.
 */
export function consultaCanonica(
  entrada: ParamsEntrada | string,
  opciones: { sinOrden?: boolean; sinColumna?: ColumnaLista } = {},
): string {
  const params = typeof entrada === "string" ? new URLSearchParams(entrada) : entrada;
  const out = new URLSearchParams();
  const saltear = new Set<string>(
    opciones.sinColumna !== undefined ? CLAVES_GRUPO[opciones.sinColumna] : [],
  );
  for (const clave of CLAVES_FILTRO) {
    if (saltear.has(clave)) continue;
    const valores = todos(params, clave)
      .map(normalizarValor)
      .filter((v) => v !== "");
    const elegidos = CLAVES_LISTA_SET.has(clave)
      ? [...new Set(valores)].sort()
      : valores.slice(0, 1);
    for (const v of elegidos) out.append(clave, v);
  }
  if (opciones.sinOrden !== true) {
    for (const n of leerOrden(params)) {
      out.append("orden", n.campo);
      out.append("dir", n.dir);
    }
  }
  return out.toString();
}

// ---------------------------------------------------------------------------
// Listas de valores
// ---------------------------------------------------------------------------

/**
 * Lo que una lista de filtro escribe en la URL, o `null` si lo que hay marcado
 * no se puede aplicar (nada marcado, o más valores de los que admite el tope).
 * "Sin filtro" devuelve un objeto vacío: aplicarlo limpia la columna.
 */
export function valoresDeLista(res: Resolucion, columna: ColumnaLista): ValoresGrupo | null {
  const d = DEFINICIONES_LISTA[columna];
  switch (res.tipo) {
    case "sin-filtro":
      return {};
    case "incluir":
      return { [d.incluir]: res.valores };
    case "excluir":
      return { [d.excluir]: res.valores };
    case "ninguno":
    case "demasiados":
      return null;
  }
}

/** Por qué una lista no se puede aplicar, dicho en la lista; `null` si se puede. */
export function avisoDeLista(res: Resolucion, columna: ColumnaLista): string | null {
  const plural = DEFINICIONES_LISTA[columna].plural;
  if (res.tipo === "ninguno") return `Marcá al menos un valor de ${plural}.`;
  if (res.tipo === "demasiados")
    return `Marcaste demasiados valores para la URL (hasta ${LISTA_MAX} por lista). Buscá y marcá solo los que necesitás, o marcá todo y desmarcá los que sobran.`;
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

/** Nombre legible de un valor de lista: el texto de "vacío" sin los paréntesis. */
export function valorLegible(valor: string): string {
  return VALORES_VACIOS.has(valor) ? valor.replace(/^\(|\)$/g, "") : valor;
}

function listaCorta(valores: readonly string[]): string {
  const legibles = valores.map(valorLegible);
  return legibles.length <= 2 ? legibles.join(", ") : `${legibles.length} valores`;
}

function textoLista(columna: ColumnaLista, lista: ListaUrl): string {
  const d = DEFINICIONES_LISTA[columna];
  if (lista.incluir.length > 0) return `${d.etiqueta}: ${listaCorta(lista.incluir)}`;
  const menos =
    lista.excluir.length <= 2 ? listaCorta(lista.excluir) : `${lista.excluir.length} ${d.plural}`;
  return `${d.etiqueta}: ${d.todas} menos ${menos}`;
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
  for (const c of COLUMNAS_LISTA) {
    if (grupoActivo(f, c)) out.push({ grupo: c, texto: textoLista(c, f.listas[c]) });
  }
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
 * Lee un número escrito como se escribe en español: coma decimal ("1500,50") y
 * punto de miles ("1.500,50"). También acepta el punto decimal de siempre
 * ("1500.50"). Devuelve `null` si no es un número, o si es negativo.
 *
 * Un punto solo es ambiguo: "1.500" puede ser mil quinientos o uno con cinco.
 * Se lee como miles cuando tiene la forma de miles (uno a tres dígitos que no
 * empiezan en 0 y grupos de tres: "1.500", "12.345.678") porque es como la propia
 * pantalla escribe los números ("1.500 productos"); "0.500", "2.5" o "1500.50" son
 * decimales.
 */
export function parsearNumero(texto: string): number | null {
  const t = normalizarValor(texto);
  const MILES = /^[1-9]\d{0,2}(\.\d{3})+$/;
  let canonico: string;
  if (t.includes(",")) {
    const partes = t.split(",");
    const [entera, decimal] = partes;
    if (partes.length !== 2 || entera === undefined || decimal === undefined) return null;
    if (!/^\d+$/.test(decimal)) return null;
    if (/^\d+$/.test(entera)) canonico = `${entera}.${decimal}`;
    else if (MILES.test(entera)) canonico = `${entera.replaceAll(".", "")}.${decimal}`;
    else return null;
  } else if (/^\d+$/.test(t)) {
    canonico = t;
  } else if (MILES.test(t)) {
    canonico = t.replaceAll(".", "");
  } else if (/^\d+\.\d+$/.test(t)) {
    canonico = t;
  } else {
    return null;
  }
  const n = Number(canonico);
  return Number.isFinite(n) ? n : null;
}

/**
 * El número tal como lo lee el backend: punto decimal y sin miles. Vacío es "" (sin
 * límite) y lo que no es un número es `null`.
 */
export function numeroCanonico(texto: string): string | null {
  if (normalizarValor(texto) === "") return "";
  const n = parsearNumero(texto);
  return n === null ? null : String(n);
}

/**
 * Lo que va en el campo cuando el número viene de la URL: coma decimal y sin miles,
 * para que `parsearNumero` lo lea igual. Un valor que no es un número se deja tal
 * cual: el campo lo marca como error en vez de corregirlo en silencio.
 */
export function numeroEditable(valorDeUrl: string): string {
  if (valorDeUrl === "") return "";
  const n = Number(valorDeUrl);
  return Number.isFinite(n) ? String(n).replace(".", ",") : valorDeUrl;
}

/**
 * Error de un par mínimo/máximo, o `null` si está bien. Lo que el service
 * rechazaría con `ValidationError` se frena acá, en el campo, antes de navegar.
 * Los números se leen con `parsearNumero`.
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
    if (normalizarValor(v) === "") continue;
    const n = parsearNumero(v);
    if (n === null) return `El ${lado} de ${opciones.nombre} tiene que ser un número desde 0.`;
    if (opciones.entero && !Number.isInteger(n))
      return `El ${lado} de ${opciones.nombre} tiene que ser un número entero.`;
  }
  const a = parsearNumero(min);
  const b = parsearNumero(max);
  if (a !== null && b !== null && a > b) {
    return `El mínimo de ${opciones.nombre} no puede ser mayor que el máximo.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mensajes cuando el service rechaza los filtros
// ---------------------------------------------------------------------------

const NOMBRE_CLAVE: Record<string, string> = {
  ...Object.fromEntries(
    COLUMNAS_LISTA.flatMap((c) => {
      const d = DEFINICIONES_LISTA[c];
      return [
        [d.incluir, d.etiqueta],
        [d.excluir, d.etiqueta],
      ];
    }),
  ),
  precioMin: "Precio",
  precioMax: "Precio",
  stockMin: "Stock",
  stockMax: "Stock",
  conStock: "Stock",
  estado: "Estado",
  q: "Búsqueda",
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
    if (CLAVES_LISTA_SET.has(clave)) {
      out.add(
        mensaje.includes("no se pueden usar juntas")
          ? `${nombre}: la URL incluye y excluye valores a la vez. Quitá el filtro y volvé a elegir.`
          : `${nombre}: hay más de ${LISTA_MAX} valores elegidos. Usá la búsqueda de la lista para acotar.`,
      );
      continue;
    }
    if (clave === "q") {
      out.add(`${nombre}: el texto admite hasta ${TEXTO_MAX} caracteres.`);
      continue;
    }
    if (["precioMin", "precioMax", "stockMin", "stockMax"].includes(clave)) {
      out.add(`${nombre}: ingresá un número válido, desde 0.`);
      continue;
    }
    out.add("Hay filtros en la URL que no son válidos.");
  }
  if (out.size === 0) out.add("Hay filtros en la URL que no son válidos.");
  return [...out];
}
