import { normalizarValor } from "@/lib/catalogo/normalizar-valor";

/**
 * Las columnas del catálogo de `/productos` y lo que cada una sabe hacer.
 *
 * Es el único lugar donde se dice qué columnas tienen lista de valores, cómo se
 * llaman en la URL y en el jsonb de Postgres, qué texto ocupa el lugar de un valor
 * vacío y por qué campos se puede ordenar. Lo leen el schema Zod, el repo
 * in-memory (que espeja el SQL), el repo de Supabase, el traductor de la URL y la
 * pantalla: si una columna cambia acá, cambia en todos.
 *
 * Sin dependencias de React ni de servidor: se importa de los dos lados.
 */

/** Las columnas con lista de valores estilo Excel, en el orden en que se ven. */
export const COLUMNAS_LISTA = [
  "codigo",
  "codigoFabrica",
  "otrosCodigos",
  "categoria",
  "descripcion",
  "marca",
] as const;

export type ColumnaLista = (typeof COLUMNAS_LISTA)[number];

/**
 * Los valores vacíos de cada lista. Toda fila tiene un valor que se puede marcar,
 * y el que la lista devuelve es EXACTAMENTE el que el filtro compara. Los mismos
 * literales viven en `productos_filtrados` (migración 20261001120000).
 */
export const SIN_CODIGO_FABRICA = "(sin cód. de fábrica)";
export const SIN_OTROS_CODIGOS = "(sin otros códigos)";
export const SIN_CATEGORIA = "(sin categoría)";
export const SIN_DESCRIPCION = "(sin descripción)";
/**
 * Valor especial de la marca para los productos sin `descripcion` (nula o en
 * blanco). Un producto cuya marca real fuera literalmente este texto quedaría
 * mezclado con los sin marca; no existe hoy en el catálogo.
 */
export const SIN_MARCA = "(sin marca)";

export interface DefinicionColumnaLista {
  columna: ColumnaLista;
  /** Cómo se llama en el título del panel y en los chips: "Cód. fábrica". */
  etiqueta: string;
  /** Plural en minúscula, para los avisos: "marcas". */
  plural: string;
  /** "todas" / "todos", para "todas menos…". */
  todas: "todas" | "todos";
  /** Clave de URL y del objeto filtrado para "solo estos". */
  incluir: ClaveLista;
  /** Clave de URL y del objeto filtrado para "todos menos estos". */
  excluir: ClaveLista;
  /** Claves del jsonb que lee Postgres. */
  jsonIncluir: string;
  jsonExcluir: string;
  /** Nombre de la columna en `productos_filtrados` y `productos_faceta`. */
  sql: string;
  /** Texto del valor vacío, o `null` si la columna nunca está vacía. */
  vacio: string | null;
  /**
   * Identificador: el buscador del panel compara por igualdad (tras recortar, sin
   * distinguir mayúsculas ni tildes) y no por subcadena. Buscar `3` ofrece solo
   * `3`, no `13` ni `30`; y el orden de la lista es numérico.
   */
  identificador: boolean;
}

export type ClaveLista =
  | "codigos"
  | "sinCodigos"
  | "codigosFabrica"
  | "sinCodigosFabrica"
  | "otrosCodigos"
  | "sinOtrosCodigos"
  | "categorias"
  | "sinCategorias"
  | "descripciones"
  | "sinDescripciones"
  | "marcas"
  | "sinMarcas";

export const DEFINICIONES_LISTA: Readonly<Record<ColumnaLista, DefinicionColumnaLista>> = {
  codigo: {
    columna: "codigo",
    etiqueta: "Código",
    plural: "códigos",
    todas: "todos",
    incluir: "codigos",
    excluir: "sinCodigos",
    jsonIncluir: "codigos",
    jsonExcluir: "sin_codigos",
    sql: "codigo",
    vacio: null,
    identificador: true,
  },
  codigoFabrica: {
    columna: "codigoFabrica",
    etiqueta: "Cód. fábrica",
    plural: "códigos de fábrica",
    todas: "todos",
    incluir: "codigosFabrica",
    excluir: "sinCodigosFabrica",
    jsonIncluir: "codigos_fabrica",
    jsonExcluir: "sin_codigos_fabrica",
    sql: "codigo_fabrica",
    vacio: SIN_CODIGO_FABRICA,
    identificador: false,
  },
  otrosCodigos: {
    columna: "otrosCodigos",
    etiqueta: "Otros códigos",
    plural: "otros códigos",
    todas: "todos",
    incluir: "otrosCodigos",
    excluir: "sinOtrosCodigos",
    jsonIncluir: "otros_codigos",
    jsonExcluir: "sin_otros_codigos",
    sql: "otros_codigos",
    vacio: SIN_OTROS_CODIGOS,
    identificador: false,
  },
  categoria: {
    columna: "categoria",
    etiqueta: "Categoría",
    plural: "categorías",
    todas: "todas",
    incluir: "categorias",
    excluir: "sinCategorias",
    jsonIncluir: "categorias",
    jsonExcluir: "sin_categorias",
    sql: "categoria",
    vacio: SIN_CATEGORIA,
    identificador: false,
  },
  descripcion: {
    columna: "descripcion",
    etiqueta: "Descripción",
    plural: "descripciones",
    todas: "todas",
    incluir: "descripciones",
    excluir: "sinDescripciones",
    jsonIncluir: "descripciones",
    jsonExcluir: "sin_descripciones",
    sql: "descripcion",
    vacio: SIN_DESCRIPCION,
    identificador: false,
  },
  marca: {
    columna: "marca",
    etiqueta: "Marca",
    plural: "marcas",
    todas: "todas",
    incluir: "marcas",
    excluir: "sinMarcas",
    jsonIncluir: "marcas",
    jsonExcluir: "sin_marcas",
    sql: "marca",
    vacio: SIN_MARCA,
    identificador: false,
  },
};

/** Todas las claves de URL que escriben las listas, en el orden de las columnas. */
export const CLAVES_LISTA: readonly ClaveLista[] = COLUMNAS_LISTA.flatMap((c) => [
  DEFINICIONES_LISTA[c].incluir,
  DEFINICIONES_LISTA[c].excluir,
]);

export function esColumnaLista(v: unknown): v is ColumnaLista {
  return typeof v === "string" && (COLUMNAS_LISTA as readonly string[]).includes(v);
}

/** Los valores vacíos de las listas, para dibujarlos distinto de un valor real. */
export const VALORES_VACIOS: ReadonlySet<string> = new Set(
  COLUMNAS_LISTA.flatMap((c) => {
    const v = DEFINICIONES_LISTA[c].vacio;
    return v === null ? [] : [v];
  }),
);

// ---------------------------------------------------------------------------
// Orden
// ---------------------------------------------------------------------------

/** Un precio por empresa del ERP: se ordena por él pero no se filtra. */
export const CAMPOS_PRECIO_EMPRESA = [
  "precio_matriz",
  "precio_magdalena",
  "precio_koreanos",
  "precio_sas_repuestos",
] as const;

/**
 * Los campos por los que se puede ordenar: las seis listas, el precio (el más barato),
 * los cuatro precios por empresa, stock y estado. Los nombres coinciden con los que
 * lee `productos_listar`.
 */
export const CAMPOS_ORDEN = [
  ...COLUMNAS_LISTA,
  "precio",
  ...CAMPOS_PRECIO_EMPRESA,
  "stock",
  "estado",
] as const;

export type CampoOrden = (typeof CAMPOS_ORDEN)[number];
export type DireccionOrden = "asc" | "desc";

export interface NivelOrden {
  campo: CampoOrden;
  dir: DireccionOrden;
}

/** Cuántos niveles de orden admite (el segundo desempata al primero, y así). */
export const NIVELES_ORDEN_MAX = 3;

/**
 * El orden con el que carga la pantalla cuando nadie eligió ninguno: por
 * descripción. NO se muestra como flecha en el encabezado: una flecha dice "elegiste
 * ordenar por acá" y nadie eligió nada. El desempate técnico (código, que es único)
 * lo agrega la consulta y nunca viaja en la URL.
 */
export const ORDEN_POR_DEFECTO: readonly NivelOrden[] = [{ campo: "descripcion", dir: "asc" }];

/** El nombre del campo como lo lee `productos_listar` en SQL (snake_case en las listas). */
export function campoOrdenSql(campo: CampoOrden): string {
  return esColumnaLista(campo) ? DEFINICIONES_LISTA[campo].sql : campo;
}

export function esCampoOrden(v: unknown): v is CampoOrden {
  return typeof v === "string" && (CAMPOS_ORDEN as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// El valor de una fila en cada columna de lista (espejo de `productos_filtrados`)
// ---------------------------------------------------------------------------

/** Lo mínimo que hace falta de un producto para calcular los valores de las listas. */
export interface FilaConValores {
  codigo_interno: string;
  codigo_fabrica: string | null;
  otros_codigos: readonly string[];
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
}

/**
 * El valor con el que una fila aparece en la lista de `columna`: el texto recortado
 * (los mismos espacios que `btrim` en SQL, ver `normalizarValor`), o el texto de
 * "vacío" de la columna si queda en blanco. El código no se toca: es único y es la
 * clave de la fila.
 */
export function valorDeColumna(p: FilaConValores, columna: ColumnaLista): string {
  switch (columna) {
    case "codigo":
      return p.codigo_interno;
    case "codigoFabrica":
      return normalizarValor(p.codigo_fabrica ?? "") || SIN_CODIGO_FABRICA;
    case "otrosCodigos":
      return normalizarValor(p.otros_codigos.join(", ")) || SIN_OTROS_CODIGOS;
    case "categoria":
      return normalizarValor(p.categoria ?? "") || SIN_CATEGORIA;
    case "descripcion":
      return normalizarValor(p.nombre) || SIN_DESCRIPCION;
    case "marca":
      return normalizarValor(p.descripcion ?? "") || SIN_MARCA;
  }
}

/**
 * Los niveles de orden de una URL: `orden=campo&dir=asc|desc`, repetidos. El
 * `dir` de la posición i va con el `orden` de la posición i. Un campo desconocido
 * o repetido se descarta y solo `desc` invierte (cualquier otra cosa es ascendente):
 * `?orden=` se puede escribir a mano y el campo no pasa crudo a ninguna consulta.
 * Hasta `NIVELES_ORDEN_MAX` niveles. Sin ninguno válido devuelve `[]`, que es "el
 * orden por defecto".
 */
export function leerNiveles(ordenes: readonly unknown[], dirs: readonly unknown[]): NivelOrden[] {
  const out: NivelOrden[] = [];
  const vistos = new Set<CampoOrden>();
  for (let i = 0; i < ordenes.length && out.length < NIVELES_ORDEN_MAX; i += 1) {
    const campo = ordenes[i];
    if (!esCampoOrden(campo) || vistos.has(campo)) continue;
    vistos.add(campo);
    out.push({ campo, dir: dirs[i] === "desc" ? "desc" : "asc" });
  }
  return out;
}
