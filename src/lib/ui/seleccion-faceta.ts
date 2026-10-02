import { LISTA_MAX } from "@/lib/validation/productos-filtros.schema";
import type { Faceta } from "@/types/productos";

/**
 * Qué casillas están marcadas en una lista de filtro estilo Excel, y cómo eso
 * se traduce a la URL.
 *
 * El backend no tiene "valores elegidos": tiene dos listas excluyentes por
 * columna, `marcas` (solo estas) y `sinMarcas` (todas menos estas), y cada una
 * acotada a 300. La selección se modela igual —un modo y un conjunto— porque es
 * lo único que se puede expresar cuando la lista que se ve está recortada o
 * filtrada por la búsqueda y hay valores que no se están mostrando:
 *
 * - `excluir` con el conjunto vacío es "todo marcado", el estado de partida.
 *   Desmarcar un valor lo agrega al conjunto.
 * - `incluir` es "solo estos". Se llega desde "deseleccionar todo" o desde un
 *   link que ya traía `?marcas=`.
 *
 * Al aplicar, si la lista está completa en pantalla se elige la representación
 * más corta de las dos (que además nunca pasa de 300); si no, se respeta el modo
 * porque los valores ocultos solo se pueden describir así.
 */

export type ModoSeleccion = "incluir" | "excluir";

export interface Seleccion {
  readonly modo: ModoSeleccion;
  readonly valores: ReadonlySet<string>;
}

/** Todo marcado: es el estado de una columna sin filtro. */
export const TODO: Seleccion = { modo: "excluir", valores: new Set() };
/** Nada marcado: un estado de pasada, no se puede aplicar. */
export const NADA: Seleccion = { modo: "incluir", valores: new Set() };

export function seleccionDesdeUrl(
  incluir: readonly string[],
  excluir: readonly string[],
): Seleccion {
  if (incluir.length > 0) return { modo: "incluir", valores: new Set(incluir) };
  return { modo: "excluir", valores: new Set(excluir) };
}

export function estaMarcado(s: Seleccion, valor: string): boolean {
  return s.modo === "incluir" ? s.valores.has(valor) : !s.valores.has(valor);
}

/** Marca o desmarca varios valores a la vez, conservando el modo. */
export function ponerMarca(s: Seleccion, valores: readonly string[], marcar: boolean): Seleccion {
  const siguiente = new Set(s.valores);
  // En `incluir` el conjunto son los marcados; en `excluir`, los desmarcados.
  const agregar = (s.modo === "incluir") === marcar;
  for (const v of valores) {
    if (agregar) siguiente.add(v);
    else siguiente.delete(v);
  }
  return { modo: s.modo, valores: siguiente };
}

export function alternarValor(s: Seleccion, valor: string): Seleccion {
  return ponerMarca(s, [valor], !estaMarcado(s, valor));
}

export type EstadoMaestro = "todos" | "ninguno" | "algunos";

/**
 * Estado de la casilla "Seleccionar todo".
 *
 * Sin búsqueda es global: habla de la columna entera, también de los valores
 * que no entran en pantalla. Con búsqueda habla solo de los resultados.
 * `completo` dice si `visibles` es toda la columna.
 */
export function estadoMaestro(
  s: Seleccion,
  visibles: readonly string[],
  opciones: { global: boolean; completo: boolean },
): EstadoMaestro {
  if (opciones.global) {
    if (s.modo === "excluir" && s.valores.size === 0) return "todos";
    if (s.modo === "incluir" && s.valores.size === 0) return "ninguno";
  }
  if (visibles.length === 0) return "ninguno";
  const marcados = visibles.filter((v) => estaMarcado(s, v)).length;
  const ocultosPosibles = opciones.global && !opciones.completo;
  if (marcados === visibles.length) {
    // Todo lo visible está marcado, pero en `incluir` lo oculto no lo está.
    return ocultosPosibles && s.modo === "incluir" ? "algunos" : "todos";
  }
  if (marcados === 0) {
    // Nada visible está marcado, pero en `excluir` lo oculto sí lo está.
    return ocultosPosibles && s.modo === "excluir" ? "algunos" : "ninguno";
  }
  return "algunos";
}

/** Qué pasa al tocar "Seleccionar todo". */
export function alternarMaestro(
  s: Seleccion,
  estado: EstadoMaestro,
  visibles: readonly string[],
  global: boolean,
): Seleccion {
  if (global) return estado === "todos" ? NADA : TODO;
  return ponerMarca(s, visibles, estado !== "todos");
}

export type Resolucion =
  | { tipo: "sin-filtro" }
  | { tipo: "incluir"; valores: string[] }
  | { tipo: "excluir"; valores: string[] }
  /** No hay nada marcado: ningún producto podría coincidir. No se aplica. */
  | { tipo: "ninguno" }
  /** Ninguna de las dos representaciones entra en el tope de la URL. */
  | { tipo: "demasiados"; cantidad: number };

/** `true` si `faceta` trae todos los valores de la columna (y no una búsqueda). */
export function listaCompleta(faceta: Faceta, hayBusqueda: boolean): boolean {
  if (hayBusqueda) return false;
  return faceta.valores.filter((v) => v.cantidad > 0).length >= faceta.distintos;
}

const binario = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Cuánto de la URL pueden ocupar los valores de una lista, en caracteres ya codificados. */
export const PRESUPUESTO_URL_DEFAULT = 6000;

export interface OpcionesResolucion {
  /**
   * Hay otros filtros activos (una búsqueda, el de otra columna…): la lista que se
   * ve es solo lo que esos filtros dejan pasar. Sin ellos la lista ES la columna.
   */
  otrosFiltros?: boolean;
  limite?: number;
  /**
   * Cuántos caracteres (codificados) caben en la URL para esta lista. 300 valores de
   * una descripción larga pasan de los 16 KB que Node admite en los encabezados y el
   * servidor contesta 431: el tope de cantidad solo no alcanza. Sin él, no se cuenta.
   */
  presupuestoChars?: number;
  /** Lo que cuesta cada valor además de su texto: `&clave=`. */
  sobrecargaPorValor?: number;
}

/**
 * De la selección a lo que se escribe en la URL.
 *
 * `universo` es la lista completa de valores cuando se conoce (si no, `null`).
 * Con la lista completa: todo marcado es "sin filtro" y nada marcado no se aplica.
 *
 * Entre incluir y excluir, el filtro respeta cómo lo armó quien lo usa: desmarcar
 * desde "todo" es excluir; partir de "deseleccionar todo" y marcar es incluir.
 * Solo sin otros filtros activos se elige la representación más corta (en un
 * empate, incluir), porque ahí las dos significan lo mismo. Con otros filtros no:
 * "solo A y B" y "todas menos C" coinciden mientras la búsqueda muestra A, B y C,
 * pero al quitar la búsqueda aparecen D y E y la segunda los incluye sin que nadie
 * lo haya pedido. En cualquier caso se cambia de representación si la pedida no
 * entra en el tope de la URL y la otra sí.
 */
export function resolverSeleccion(
  s: Seleccion,
  universo: readonly string[] | null,
  {
    otrosFiltros = false,
    limite = LISTA_MAX,
    presupuestoChars = Number.POSITIVE_INFINITY,
    sobrecargaPorValor = 12,
  }: OpcionesResolucion = {},
): Resolucion {
  /** Entra en la URL: no más de `limite` valores y no más de `presupuestoChars` caracteres. */
  const cabe = (valores: readonly string[]): boolean =>
    valores.length <= limite &&
    valores.reduce((suma, v) => suma + encodeURIComponent(v).length + sobrecargaPorValor, 0) <=
      presupuestoChars;
  if (universo !== null) {
    const marcados = universo.filter((v) => estaMarcado(s, v));
    const desmarcados = universo.filter((v) => !estaMarcado(s, v));
    if (desmarcados.length === 0) return { tipo: "sin-filtro" };
    if (marcados.length === 0) return { tipo: "ninguno" };
    const incluir = { tipo: "incluir" as const, valores: [...marcados].sort(binario) };
    const excluir = { tipo: "excluir" as const, valores: [...desmarcados].sort(binario) };
    const pedida = otrosFiltros
      ? s.modo === "incluir"
        ? incluir
        : excluir
      : excluir.valores.length < incluir.valores.length
        ? excluir
        : incluir;
    const otra = pedida === incluir ? excluir : incluir;
    if (cabe(pedida.valores)) return pedida;
    if (cabe(otra.valores)) return otra;
    return { tipo: "demasiados", cantidad: Math.min(marcados.length, desmarcados.length) };
  }

  const valores = [...s.valores].sort(binario);
  if (s.modo === "incluir") {
    if (valores.length === 0) return { tipo: "ninguno" };
    if (!cabe(valores)) return { tipo: "demasiados", cantidad: valores.length };
    return { tipo: "incluir", valores };
  }
  if (valores.length === 0) return { tipo: "sin-filtro" };
  if (!cabe(valores)) return { tipo: "demasiados", cantidad: valores.length };
  return { tipo: "excluir", valores };
}
