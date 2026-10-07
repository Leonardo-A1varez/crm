import {
  analizarConsulta,
  INDICE_VACIO,
  raizDe,
  terminosDe,
  tokenDiceLaPalabra,
  tokensDe,
  valeEn,
  type IndiceAbreviaturas,
  type PalabraAnalizada,
} from "@/lib/catalogo/abreviaturas";
import { palabrasDe } from "@/lib/catalogo/puntaje";
import { plegarTexto } from "@/lib/catalogo/plegar-texto";
import { etiquetaDePieza } from "@/lib/catalogo/compatibilidad";

/**
 * Cuánto se parece la categoría del ERP (`BOMBA DE AGUA`) a lo que pidió el
 * cliente.
 *
 * OBSERVACION: "una bomba de agua para el Rio 18" ofrecía como piezas los
 * manguitos del radiador y la bomba de combustible. CAUSA RAIZ: la búsqueda de
 * texto acepta CUALQUIER palabra (`agua` en `MANG PASO AGUA`, `bomba` en `BOMBA
 * COMPLETA COMBUST INYEC`) y `diferencias` tomaba cada categoría entre los
 * candidatos como una opción de pieza. Una categoría que solo comparte una
 * palabra con una frase de dos no es una alternativa: es ruido.
 *
 * Espeja el `nivel_cat` de `buscar_productos` (20261007140000), que usa los
 * niveles 0, 1 y 2; el 3 solo existe acá.
 */

/**
 * Palabras que dicen "el conjunto" y no cuál es la pieza: se resuelven con la
 * lógica de subpiezas (`etiquetaDePieza`), no contra el texto de la categoría.
 * `BOMBA COMPLETA COMBUST INYEC` no es "la bomba completa" que pidió el cliente.
 */
const CALIFICADORES = new Set([
  "completa",
  "completo",
  "completas",
  "completos",
  "conjunto",
  "armado",
  "armada",
  "kit",
  "original",
  "originales",
]);

/** Los calificadores que piden el conjunto entero y no una parte. */
const PIDEN_CONJUNTO = new Set([
  "completa",
  "completo",
  "completas",
  "completos",
  "conjunto",
  "armado",
  "armada",
  "kit",
]);

export interface ConsultaDePieza {
  query: string;
  marca?: string | undefined;
  modelo?: string | undefined;
  /**
   * Las abreviaturas del inventario. Sin ellas, «amortiguadores delanteros» no se
   * reconoce en `AMORTIG DELT` y solo queda el prefijo.
   */
  indice?: IndiceAbreviaturas | undefined;
}

const palabrasPlegadas = (t: string | undefined): string[] =>
  plegarTexto(t ?? "")
    .split(/[^0-9a-z/.*-]+/)
    .filter((p) => p.length > 0);

/**
 * Las palabras de la consulta que dicen QUÉ pieza es: sin relleno, calificadores,
 * vehículo ni filtros (una posición como «delanteros» no es parte del nombre de la pieza).
 */
export function palabrasAnalizadasDePieza(c: ConsultaDePieza): PalabraAnalizada[] {
  const vehiculo = new Set([...palabrasPlegadas(c.marca), ...palabrasPlegadas(c.modelo)]);
  return analizarConsulta(c.query, c.indice ?? INDICE_VACIO).requeridas.filter(
    (w) => !CALIFICADORES.has(w.palabra) && !vehiculo.has(w.palabra),
  );
}

export function palabrasDePieza(c: ConsultaDePieza): string[] {
  return palabrasAnalizadasDePieza(c).map((w) => w.palabra);
}

/**
 * ¿La categoría contiene a esta palabra? Como texto, o por una abreviatura del
 * catálogo a la que se pliega, o por un prefijo suyo.
 */
function categoriaTienePalabra(cat: string, w: PalabraAnalizada): boolean {
  if (cat.includes(w.palabra)) return true;
  const tokens = tokensDe(cat);
  return terminosDe(w).some((t) => valeEn(t.ambito, "categoria") && tokens.includes(t.token));
}

/** ¿Alguna palabra de la consulta dice este token de la categoría? */
function laConsultaDice(token: string, consulta: readonly string[], c: ConsultaDePieza): boolean {
  const indice = c.indice ?? INDICE_VACIO;
  return consulta.some((q) => token === q || tokenDiceLaPalabra(token, q, indice));
}

/** ¿El cliente pidió el conjunto entero ("completa", "conjunto", "kit")? */
/**
 * ¿Las palabras de la categoría son, una por una, palabras que dijo el cliente (por
 * raíz: singular, plural, género)? No cuenta abreviaturas ni prefijos: `AMORTIG DELT`
 * no es «amortiguadores delanteros» dicho tal cual.
 */
export function categoriaDichaTalCual(
  categoria: string | null | undefined,
  c: ConsultaDePieza,
): boolean {
  const deLaCategoria = palabrasDe(plegarTexto((categoria ?? "").trim()));
  if (deLaCategoria.length === 0) return false;
  const dichas = palabrasDe(c.query).map(raizDe);
  return deLaCategoria.every((t) => dichas.includes(raizDe(t)));
}

export function pideConjunto(c: ConsultaDePieza): boolean {
  return palabrasDe(c.query).some((p) => PIDEN_CONJUNTO.has(p));
}

/**
 * 3: la categoría ES lo pedido (todas sus palabras están en la consulta).
 * 2: contiene todas las palabras de la pieza pedida.
 * 1: comparte algunas. 0: ninguna (el producto entró por el nombre).
 * `null`: no hay nada que comparar (sin categoría, o menos de dos palabras útiles).
 */
export function nivelDeCategoria(
  categoria: string | null | undefined,
  c: ConsultaDePieza,
): 0 | 1 | 2 | 3 | null {
  const cat = plegarTexto((categoria ?? "").trim());
  if (cat === "") return null;
  const palabras = palabrasAnalizadasDePieza(c);
  if (palabras.length < 2) return null;

  const coinciden = palabras.filter((w) => categoriaTienePalabra(cat, w)).length;
  if (coinciden === 0) return 0;
  if (coinciden < palabras.length) return 1;

  const dichas = palabrasDe(c.query);
  const deLaCategoria = palabrasDe(cat);
  return deLaCategoria.every((p) => laConsultaDice(p, dichas, c)) ? 3 : 2;
}

/**
 * Descarta los candidatos cuya categoría solo roza la pieza pedida, siempre que
 * alguno la contenga entera. Si el cliente pidió el conjunto ("la bomba de agua
 * completa") y hay una categoría que ES esa pieza, quedan solo esas: la polea de
 * la bomba ya no es una opción. Sin categoría que la contenga, no toca nada: más
 * vale ofrecer algo que decir "no tenemos".
 */
export function filtrarPorCategoria<T extends { categoria?: string | null | undefined }>(
  hits: readonly T[],
  c: ConsultaDePieza,
): T[] {
  const niveles = hits.map((h) => nivelDeCategoria(h.categoria, c));
  if (!niveles.some((n) => n !== null && n >= 2)) return [...hits];

  const exactas = niveles.some((n) => n === 3);
  const minimo = pideConjunto(c) && exactas ? 3 : 2;
  return hits.filter((_, i) => {
    const n = niveles[i] ?? null;
    return n === null || n >= minimo;
  });
}

const singular = (p: string): string => (p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p);

/** Qué dice el cliente cuando pide una parte o accesorio de una pieza. */
const PALABRAS_DE_SUBPIEZA: Readonly<Record<string, readonly string[]>> = {
  empaque: ["empaque", "empaquetadura", "empaq"],
  oring: ["oring", "o-ring", "anillo"],
  sello: ["sello"],
  reten: ["reten"],
  perno: ["perno"],
  base: ["base"],
  tapa: ["tapa"],
  kit: ["kit"],
  "conjunto completo": ["completo", "completa", "conjunto", "kit", "armado", "armada"],
};

/** Las partes que, nombradas en la consulta, descartan a la pieza principal. */
const PARTES_PEDIBLES = ["empaque", "oring", "sello", "reten", "perno", "base", "tapa"];

/**
 * ¿Este producto ES la pieza que pidió el cliente? Se mira la etiqueta de pieza
 * completa (categoría + lo que dice el NOMBRE: empaque, oring, base, tapa…):
 * - Sin subpieza: es la pieza si todas las palabras de su categoría están en la
 *   consulta (`TERMOSTATOS` para «termostato», `BOMBA DE AGUA` para «bomba de agua»).
 * - Con subpieza (`BOMBA DE AGUA (empaque)`): solo si la consulta la nombra
 *   («empaque de la bomba de agua») y nombra la pieza. Quien pide «bomba de agua»
 *   no pidió su empaque.
 * Una categoría que solo roza (`POLEA BOMBA AGUA E HIDRAU`) no es la pieza pedida:
 * es una pieza relacionada.
 */
export function piezaPedida(
  h: { categoria?: string | null | undefined; nombre?: string | null | undefined },
  c: ConsultaDePieza,
): boolean {
  const cat = plegarTexto((h.categoria ?? "").trim());
  if (cat === "") return false;
  const dichas = new Set(palabrasDe(c.query).map(singular));
  const deLaCategoria = palabrasDe(cat).map(singular);
  const consulta = palabrasDe(c.query);
  const categoriaDicha =
    deLaCategoria.length > 0 && deLaCategoria.every((p) => laConsultaDice(p, consulta, c));

  const etiqueta = etiquetaDePieza(h.categoria, h.nombre) ?? "";
  const sub = /\(([^()]+)\)$/.exec(etiqueta)?.[1];
  if (sub === undefined) {
    // Quien pide «el empaque de la bomba» no pidió la bomba.
    const pideUnaParte = PARTES_PEDIBLES.some((s) =>
      (PALABRAS_DE_SUBPIEZA[s] ?? []).some((p) => dichas.has(p)),
    );
    return categoriaDicha && !pideUnaParte;
  }

  const cabeza = deLaCategoria[0];
  if (!categoriaDicha && (cabeza === undefined || !laConsultaDice(cabeza, consulta, c))) {
    return false;
  }
  return (PALABRAS_DE_SUBPIEZA[sub] ?? []).some((p) => dichas.has(p));
}
