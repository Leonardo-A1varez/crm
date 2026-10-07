import { plegarTexto } from "@/lib/catalogo/plegar-texto";
import { etiquetaDeOrigen, resolverOrigen, type IndiceMarcas } from "@/lib/catalogo/procedencia";
import type { CompatibilidadEntry } from "@/types/entities";

/**
 * Compatibilidad de un producto con un vehículo.
 *
 * **Este módulo es el espejo TypeScript del filtro de vehículo de
 * `public.buscar_productos` y de `public.resolver_modelos`**
 * (20261005120100_buscar_productos_compatibilidad.sql). Uno corre en Postgres y
 * el otro en el repo in-memory y en los tests. Los dos se prueban con los mismos
 * casos (`tests/helpers/catalogo-compat-fixtures.ts`): si se separan, falla uno
 * de los dos tests, no el agente en producción.
 */

/**
 * Un elemento de `productos.compatibilidad`, como lo escribe el traductor del
 * inventario: el modelo va en la SIGLA del catálogo (`ACC`) y no en el nombre
 * que dice el cliente (`Accent`).
 *
 * Todo lo que no sea marca y modelo puede faltar: `null` es "no sabemos", no
 * "no sirve". Un `anio_desde` nulo es "desde siempre"; un `anio_hasta` nulo, "hasta hoy".
 */
export type ElementoCompatibilidad = CompatibilidadEntry;

/** Una fila de `catalogo_modelos`. */
export interface ModeloCatalogo {
  marca: string;
  sigla_modelo: string;
  nombre_real: string;
  alias: readonly string[];
  confianza: "alta" | "media" | "baja";
  confirmado: boolean;
}

/** Marca y sigla ya plegadas: lo que se compara contra la compatibilidad. */
export interface ModeloResuelto {
  marca: string;
  sigla: string;
  /** `nombre_real` plegado: se compara contra `modelo_nombre` de la compatibilidad. */
  nombre: string;
  /**
   * `true` si el cliente nombró ESTE modelo; `false` si solo entró por prefijo
   * ("Accent" también trae "Accent Verna", que es otro modelo). Si ninguno
   * coincide por igualdad —"Tucson" y sus generaciones— todos valen `true`.
   */
  exacto: boolean;
}

/** Lo que dijo el cliente sobre el vehículo. */
export interface FiltroVehiculo {
  marca?: string | undefined;
  modelo?: string | undefined;
  anio?: number | undefined;
  /** Ya normalizada con `normalizarCilindrada`. */
  cilindrada?: string | undefined;
}

const numeroONulo = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const textoONulo = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const combustibleONulo = (v: unknown): "GAS" | "DSL" | null =>
  v === "GAS" || v === "DSL" ? v : null;

/**
 * Lee `compatibilidad` tal como vuelve de Postgres (`jsonb`). Descarta lo que no
 * tenga marca y modelo en vez de tirar: un elemento mal escrito no tiene que
 * voltear la búsqueda entera.
 */
export function leerCompatibilidad(json: unknown): ElementoCompatibilidad[] {
  if (!Array.isArray(json)) return [];
  const salida: ElementoCompatibilidad[] = [];
  for (const e of json as unknown[]) {
    if (typeof e !== "object" || e === null) continue;
    const r = e as Record<string, unknown>;
    const marca = textoONulo(r["marca"]);
    const modelo = textoONulo(r["modelo"]);
    if (marca === null || modelo === null) continue;
    const motor = textoONulo(r["motor"]);
    salida.push({
      marca,
      modelo,
      ...(motor !== null ? { motor } : {}),
      anio_desde: numeroONulo(r["anio_desde"]),
      anio_hasta: numeroONulo(r["anio_hasta"]),
      cilindrada: textoONulo(r["cilindrada"]),
      combustible: combustibleONulo(r["combustible"]),
      modelo_nombre: textoONulo(r["modelo_nombre"]),
    });
  }
  return salida;
}

/** Misma regla que la columna generada `activo` de `catalogo_modelos`. */
export function modeloActivo(m: Pick<ModeloCatalogo, "confianza" | "confirmado">): boolean {
  return m.confirmado || m.confianza === "alta";
}

/** Misma regla que la columna generada `nombre_clave`: el nombre real sin la marca. */
export function nombreClave(m: Pick<ModeloCatalogo, "marca" | "nombre_real">): string {
  const nombre = plegarTexto(m.nombre_real);
  const marca = plegarTexto(m.marca);
  return nombre.slice(0, marca.length + 1) === `${marca} `
    ? nombre.slice(marca.length + 1)
    : nombre;
}

const nulaSiVacia = (s: string | undefined): string | null => {
  const t = plegarTexto((s ?? "").trim());
  return t === "" ? null : t;
};

/**
 * Traduce lo que dijo el cliente a las siglas del inventario. Espeja
 * `public.resolver_modelos`: vacío si no resuelve.
 */
export function resolverModelos(
  modelos: readonly ModeloCatalogo[],
  marca: string | undefined,
  modelo: string | undefined,
): ModeloResuelto[] {
  const m = nulaSiVacia(modelo);
  if (m === null) return [];
  const k = nulaSiVacia(marca);

  const salida = new Map<string, ModeloResuelto>();
  const porIgualdad = new Set<string>();
  for (const c of modelos) {
    if (!modeloActivo(c)) continue;
    const marcaC = plegarTexto(c.marca);
    const nombre = plegarTexto(c.nombre_real);
    // La marca puede ser la del diccionario o la que lleva el nombre real.
    if (k !== null && marcaC !== k && nombre.slice(0, k.length + 1) !== `${k} `) continue;

    const sigla = plegarTexto(c.sigla_modelo);
    const clave = nombreClave(c);
    // El nombre sin su primera palabra: para los modelos catalogados bajo una
    // marca y llamados con otra ("Chevrolet Vitara" bajo SUZUKI).
    const resto = nombre.slice(nombre.indexOf(" ") + 1);
    const igual =
      sigla === m ||
      nombre === m ||
      clave === m ||
      resto === m ||
      c.alias.some((a) => plegarTexto(a) === m);
    // "tucson" sirve para "tucson 1a gen (jm)". Comparación literal, no LIKE:
    // un `%` escrito por el cliente no es un comodín.
    const prefijo =
      clave.slice(0, m.length + 1) === `${m} ` || resto.slice(0, m.length + 1) === `${m} `;
    if (!igual && !prefijo) continue;
    const llave = `${marcaC}|${sigla}`;
    if (igual) porIgualdad.add(llave);
    salida.set(llave, { marca: marcaC, sigla, nombre, exacto: false });
  }
  // Si nadie coincide por igualdad, lo que entró por prefijo ES lo que pidió.
  for (const [llave, r] of salida) {
    r.exacto = porIgualdad.size === 0 || porIgualdad.has(llave);
  }
  return [...salida.values()];
}

/**
 * Cilindrada como la guarda `compatibilidad` ("1.6"), a partir de lo que escribe
 * un cliente o produce un modelo: "1,6", "1.6L", "1.6 litros", "1600", "1598cc".
 * `undefined` si no se puede leer una cilindrada de ahí.
 */
export function normalizarCilindrada(valor: string | undefined | null): string | undefined {
  if (valor === undefined || valor === null) return undefined;
  const t = valor.trim().toLowerCase().replace(",", ".");
  const decimal = /^(\d)\.(\d)0*\s*(?:l|lt|lts|litros?)?$/.exec(t);
  if (decimal) return `${decimal[1]}.${decimal[2]}`;
  const cc = /^(\d{3,4})\s*(?:cc|cm3)?$/.exec(t);
  if (cc) {
    const litros = Number(cc[1]) / 1000;
    if (litros >= 0.6 && litros < 10) return litros.toFixed(1);
  }
  return undefined;
}

/** La misma limpieza que hace `buscar_productos` con `p_cilindrada`. */
function cilindradaDeFiltro(c: string | undefined): string | null {
  const t = (c ?? "")
    .trim()
    .replace(",", ".")
    .replace(/[^0-9.]/g, "");
  return t === "" ? null : t;
}

const tieneValor = (v: string | null | undefined): v is string =>
  v !== undefined && v !== null && v !== "";

/**
 * Cuánto vale cada dato que un elemento de compatibilidad confirma. Espeja el
 * `nivel` de `buscar_productos`.
 *
 * El modelo exacto pesa más que cualquier combinación de año y cilindrada: un
 * elemento de la variante Verna con año y cilindrada declarados no le gana a un
 * Accent sin ellos, porque el cliente dijo Accent.
 */
const NIVEL = { modeloExacto: 4, cilindrada: 2, anio: 1 } as const;

/** Sin compatibilidad cargada: "no sabemos". Va después de lo que sí sirve. */
export const NIVEL_SIN_COMPATIBILIDAD = -1;
/**
 * Declara el modelo pedido pero en otro año o cilindrada, y solo entra por una
 * variante. Va al final: es la pieza del Accent 1.4 que apareció para un 1.6.
 */
export const NIVEL_CONTRADICE = -2;

interface Evaluacion {
  elemento: ElementoCompatibilidad;
  /** Marca y modelo coinciden con lo pedido (sin mirar año ni cilindrada). */
  vehiculoOk: boolean;
  /** Además de `vehiculoOk`, es el modelo que el cliente nombró y no una variante. */
  exacto: boolean;
  /** Sirve para el vehículo: `vehiculoOk` más año y cilindrada. */
  sirve: boolean;
}

function evaluarElementos(
  compatibilidad: readonly ElementoCompatibilidad[],
  filtro: FiltroVehiculo,
  resueltos: readonly ModeloResuelto[],
  textoProducto: string,
): Evaluacion[] {
  const marca = nulaSiVacia(filtro.marca);
  const modelo = nulaSiVacia(filtro.modelo);
  const anio = filtro.anio;
  const cilindrada = cilindradaDeFiltro(filtro.cilindrada);
  const modeloResuelto = resueltos.length > 0;

  return compatibilidad.map((e) => {
    const marcaE = plegarTexto(e.marca);
    const modeloE = plegarTexto(e.modelo);
    const nombreE = e.modelo_nombre ? plegarTexto(e.modelo_nombre) : null;
    // `MARCA TODOS` del inventario: sirve para cualquier modelo de la marca.
    const esTodos = modeloE === "todos";

    let vehiculoOk: boolean;
    let exacto: boolean;
    if (modelo === null) {
      vehiculoOk = marca === null || marcaE === marca;
      exacto = vehiculoOk;
    } else if (modeloResuelto) {
      vehiculoOk = resueltos.some(
        (r) => r.marca === marcaE && (r.sigla === modeloE || r.nombre === nombreE || esTodos),
      );
      exacto = resueltos.some(
        (r) => r.exacto && r.marca === marcaE && (r.sigla === modeloE || r.nombre === nombreE),
      );
    } else {
      const mismoModelo = modeloE === modelo || nombreE === modelo;
      vehiculoOk =
        (marca === null || marcaE === marca) &&
        (mismoModelo || (marca !== null && esTodos) || textoProducto.includes(modelo));
      exacto = (marca === null || marcaE === marca) && mismoModelo;
    }

    let sirve = vehiculoOk;
    if (sirve && anio !== undefined) {
      if (e.anio_desde !== null && e.anio_desde !== undefined && anio < e.anio_desde) sirve = false;
      if (e.anio_hasta !== null && e.anio_hasta !== undefined && anio > e.anio_hasta) sirve = false;
    }
    if (sirve && cilindrada !== null && tieneValor(e.cilindrada) && e.cilindrada !== cilindrada) {
      sirve = false;
    }
    return { elemento: e, vehiculoOk, exacto, sirve };
  });
}

function sinFiltros(filtro: FiltroVehiculo): boolean {
  return (
    nulaSiVacia(filtro.marca) === null &&
    nulaSiVacia(filtro.modelo) === null &&
    filtro.anio === undefined &&
    cilindradaDeFiltro(filtro.cilindrada) === null
  );
}

/**
 * Los elementos de `compatibilidad` que sirven para el vehículo pedido; todos
 * si no se pidió ninguno. Espeja el `lateral` de `buscar_productos`.
 *
 * `textoProducto` es la columna `busqueda` del producto: si el modelo no
 * resuelve a ninguna sigla, alcanza con que el texto del producto lo nombre.
 */
export function elementosCompatibles(
  compatibilidad: readonly ElementoCompatibilidad[],
  filtro: FiltroVehiculo,
  resueltos: readonly ModeloResuelto[],
  textoProducto: string,
): ElementoCompatibilidad[] {
  if (sinFiltros(filtro)) return [...compatibilidad];
  return evaluarElementos(compatibilidad, filtro, resueltos, textoProducto)
    .filter((v) => v.sirve)
    .map((v) => v.elemento);
}

/** Cómo entra un producto en el resultado para un vehículo. */
export interface CompatibilidadDeProducto {
  /** Los elementos que justifican el match (vacío si "no sabemos"). */
  elementos: ElementoCompatibilidad[];
  /**
   * Qué tan bien confirma el vehículo, para ordenar: de 7 (modelo exacto con año
   * y cilindrada declarados) a 0 (solo una variante, sin datos), -1 sin
   * compatibilidad cargada y -2 si declara otro año o cilindrada del mismo modelo.
   * Sin vehículo pedido, 0 para todos.
   */
  nivel: number;
}

/**
 * Si el producto entra en el resultado para ese vehículo, con qué elementos y en
 * qué nivel. `null` si no entra.
 *
 * Una `compatibilidad` vacía significa "no sabemos", no "no sirve": entra
 * siempre, con la lista vacía.
 */
export function evaluarCompatibilidad(
  compatibilidad: readonly ElementoCompatibilidad[],
  filtro: FiltroVehiculo,
  resueltos: readonly ModeloResuelto[],
  textoProducto: string,
): CompatibilidadDeProducto | null {
  if (sinFiltros(filtro)) return { elementos: [...compatibilidad], nivel: 0 };
  if (compatibilidad.length === 0) return { elementos: [], nivel: NIVEL_SIN_COMPATIBILIDAD };

  const evaluados = evaluarElementos(compatibilidad, filtro, resueltos, textoProducto);
  const sirven = evaluados.filter((v) => v.sirve);
  if (sirven.length === 0) return null;

  const hayExactoQueSirve = sirven.some((v) => v.exacto);
  const hayExactoQueNoSirve = evaluados.some((v) => v.exacto && !v.sirve);
  if (!hayExactoQueSirve && hayExactoQueNoSirve) {
    return { elementos: sirven.map((v) => v.elemento), nivel: NIVEL_CONTRADICE };
  }

  const pidioCilindrada = cilindradaDeFiltro(filtro.cilindrada) !== null;
  const pidioAnio = filtro.anio !== undefined;
  const nivel = Math.max(
    ...sirven.map(
      (v) =>
        (v.exacto ? NIVEL.modeloExacto : 0) +
        (pidioCilindrada && tieneValor(v.elemento.cilindrada) ? NIVEL.cilindrada : 0) +
        (pidioAnio &&
        ((v.elemento.anio_desde ?? null) !== null || (v.elemento.anio_hasta ?? null) !== null)
          ? NIVEL.anio
          : 0),
    ),
  );
  return { elementos: sirven.map((v) => v.elemento), nivel };
}

/**
 * Igual que `evaluarCompatibilidad` pero solo con los elementos. Se mantiene
 * para quien no ordena.
 */
export function compatibilidadParaVehiculo(
  compatibilidad: readonly ElementoCompatibilidad[],
  filtro: FiltroVehiculo,
  resueltos: readonly ModeloResuelto[],
  textoProducto: string,
): ElementoCompatibilidad[] | null {
  return evaluarCompatibilidad(compatibilidad, filtro, resueltos, textoProducto)?.elementos ?? null;
}

// ───────────────────────── Diferencias entre candidatos ─────────────────────────

/** Los atributos que salen de la `compatibilidad` de un producto. */
export type AtributoDeCompatibilidad = "anio" | "cilindrada" | "combustible";
/** Lo que el agente puede tener que preguntar: esos atributos o qué pieza es. */
export type AtributoQueDifiere = AtributoDeCompatibilidad | "pieza";

export interface Diferencias {
  /** Lo que el agente tiene que preguntar: en qué no coinciden los mejores candidatos. */
  atributos: AtributoQueDifiere[];
  /** Los valores que aparecen, solo de los atributos que difieren. */
  valores: Partial<Record<AtributoQueDifiere, string[]>>;
  /**
   * Las opciones de una misma pieza por marca y procedencia («MOBIS (Original)»,
   * «JUNGWOO (Korea)», «China»). No se preguntan: se ofrecen, cada una con su
   * precio. Ausente si cada pieza tiene una sola.
   */
  procedencias?: string[];
  /**
   * Lo que el agente tiene que hacer con esto, dicho en el propio resultado de la
   * herramienta. En el prompt solo, un modelo chico lista igual los candidatos con
   * sus precios; pegada a los datos, la instrucción se obedece mucho más.
   */
  instruccion: string;
}

const NOMBRE_ATRIBUTO: Record<AtributoQueDifiere, string> = {
  pieza: "qué pieza necesita",
  anio: "el año",
  cilindrada: "la cilindrada",
  combustible: "el combustible (diésel o gasolina)",
};

/** Arma `Diferencias` con su instrucción. */
export function construirDiferencias(
  atributos: AtributoQueDifiere[],
  valores: Partial<Record<AtributoQueDifiere, string[]>>,
  procedencias: readonly string[] = [],
  relacionadas: readonly string[] = [],
): Diferencias {
  if (atributos.length > 0) {
    // Con algo por preguntar, la salida no trae precios (ni las procedencias que
    // se cotizarían con ellos): un modelo que ve precios los lista igual.
    const que = atributos.map((a) => NOMBRE_ATRIBUTO[a]).join(" y ");
    return {
      atributos,
      valores,
      instruccion:
        `Hay más de una versión y se diferencian en: ${que}. ` +
        "Preguntale solo eso, en una línea, ofreciendo las opciones de `valores`. " +
        "Esta respuesta no trae precios: no los des ni los estimes. " +
        (atributos.includes("pieza")
          ? "Si el cliente ya eligió la pieza, no la repitas: buscá de nuevo con esa pieza."
          : ""),
    };
  }
  const partes: string[] = [];
  if (procedencias.length > 0) {
    partes.push(
      `La misma pieza viene en distintas opciones (${procedencias.join(", ")}): ` +
        "no las preguntes, cotizá cada una como «MARCA (Procedencia) $precio» (IVA incluido), " +
        "con la `marca` y la `procedencia` de cada candidato; si no trae `marca`, «PROCEDENCIA $precio»; " +
        "si no trae `procedencia`, «MARCA $precio». Sin rangos.",
    );
  }
  if (relacionadas.length > 0) {
    partes.push(
      `Después de cotizar, UNA línea corta ofreciendo las piezas relacionadas por su nombre, sin precios ` +
        `(${relacionadas.join(", ")}): «También tengo …, ¿te las cotizo?». Los precios solo si el cliente las pide.`,
    );
  }
  return {
    atributos,
    valores,
    ...(procedencias.length > 0 ? { procedencias: [...procedencias] } : {}),
    instruccion: partes.join(" "),
  };
}

/** Cuántos de los primeros resultados se comparan. */
export const TOPE_CANDIDATOS_DIFERENCIAS = 5;
/** Un candidato con menos de esta fracción del mejor puntaje es ruido, no alternativa. */
export const FRACCION_PUNTAJE_MINIMA = 0.5;
/**
 * Para decidir si hay que preguntar la pieza se exige más parecido: "radiador"
 * puntúa 18 contra `RADIADOR` y 12 contra la categoría `MANG RADIADOR`, y esa
 * manguera no es una alternativa que valga una pregunta.
 */
export const FRACCION_PUNTAJE_PIEZA = 0.75;
/**
 * Cuántos niveles por debajo del mejor sigue siendo evidencia comparable. 2 es lo
 * que vale confirmar la cilindrada: con año y cilindrada pedidos, un Accent sin
 * cilindrada declarada (5) sigue contando junto al que la declara (7); uno sin
 * ningún dato (4), no.
 */
export const TOLERANCIA_NIVEL = 2;

function etiquetaAnio(e: ElementoCompatibilidad): { texto: string; orden: number } | null {
  const d = e.anio_desde ?? null;
  const h = e.anio_hasta ?? null;
  if (d === null && h === null) return null;
  if (d !== null && h !== null) return { texto: d === h ? `${d}` : `${d}-${h}`, orden: d };
  if (d !== null) return { texto: `${d} en adelante`, orden: d };
  return { texto: `hasta ${h}`, orden: Number.NEGATIVE_INFINITY };
}

/** Los valores de cada atributo de un producto, como texto legible para el agente. */
export function etiquetasDeCompatibilidad(
  compatibilidad: readonly ElementoCompatibilidad[],
): Record<AtributoDeCompatibilidad, string[]> {
  const anios = new Map<string, number>();
  const cilindradas = new Set<string>();
  const combustibles = new Set<string>();
  for (const e of compatibilidad) {
    const a = etiquetaAnio(e);
    if (a) anios.set(a.texto, a.orden);
    if (tieneValor(e.cilindrada)) cilindradas.add(e.cilindrada.trim());
    if (tieneValor(e.combustible)) combustibles.add(e.combustible.trim().toUpperCase());
  }
  return {
    anio: [...anios.entries()]
      .sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]))
      .map(([t]) => t),
    cilindrada: [...cilindradas].sort(),
    combustible: [...combustibles].sort(),
  };
}

/**
 * Un grupo del ERP que junta piezas armadas con sus partes (`TERMOSTATO ARMADO Y
 * TAPAS`). Ahí las palabras clave de subpieza cuentan siempre. En cualquier otro
 * grupo cuentan también (la categoría `BOMBA DE AGUA` trae empaques), salvo que la
 * palabra sea parte de la categoría misma (`BASE MOTOR`).
 */
const GRUPO_ARMADO = /\b(armad[oa]s?|conjuntos?|kits?|tapas?)\b/;

/**
 * Palabras del nombre que dicen que el producto NO es la pieza principal del
 * grupo sino una parte o accesorio suyo. La primera que coincide gana: `EMPAQ` y
 * `ORING` antes que `COMPL`, y `COMPL` antes que `BASE`, `TAPA` y `KIT`.
 */
const SUBPIEZAS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bempaq[a-z]*/, "empaque"],
  [/\bo[- ]?rings?\b/, "oring"],
  [/\bsellos?\b/, "sello"],
  [/\breten(?:es)?\b/, "reten"],
  [/\bpernos?\b/, "perno"],
  [/\bcompl(?:eto|etos|\.)?(?![a-z])/, "conjunto completo"],
  [/\bbase\b/, "base"],
  [/\btapa\b/, "tapa"],
  [/\bkits?\b/, "kit"],
];

/**
 * Qué pieza es un producto, como texto legible para el agente: su grupo del ERP
 * (`categoria`) y, si el NOMBRE completo dice que es una parte (empaque, oring,
 * sello, retén, perno, conjunto completo, base, tapa, kit), cuál. La categoría
 * sola no alcanza: la bomba de agua y su empaque comparten grupo. `null` si el
 * producto no tiene categoría.
 */
export function etiquetaDePieza(
  categoria: string | null | undefined,
  nombre: string | null | undefined,
): string | null {
  const cat = (categoria ?? "").trim();
  if (cat === "") return null;
  const catPlegada = plegarTexto(cat);
  const armado = GRUPO_ARMADO.test(catPlegada);
  const n = plegarTexto(nombre ?? "");
  const sub = SUBPIEZAS.find(([re]) => re.test(n) && (armado || !re.test(catPlegada)));
  return sub ? `${cat} (${sub[1]})` : cat;
}

export interface CandidatoParaDiferencias {
  puntaje: number;
  compatibilidad: readonly ElementoCompatibilidad[];
  /** Qué tan bien confirma el vehículo (ver `CompatibilidadDeProducto.nivel`). Sin dato: 0. */
  nivel_vehiculo?: number | undefined;
  categoria?: string | null | undefined;
  nombre?: string | null | undefined;
  /** `productos.descripcion`: de ahí salen la marca y la procedencia. */
  descripcion?: string | null | undefined;
  /** Su sufijo (`/K`, `/JP`…) da la procedencia cuando la marca no la dice. */
  codigo_fabrica?: string | null | undefined;
}

const nivelDe = (h: CandidatoParaDiferencias): number => h.nivel_vehiculo ?? 0;

/**
 * En qué se diferencian los mejores candidatos, para que el agente pregunte solo
 * eso en vez de elegir uno.
 *
 * - Año, cilindrada y combustible: compara hasta `TOPE_CANDIDATOS_DIFERENCIAS`
 *   resultados con puntaje cercano al mejor, de mayor a menor nivel de vehículo.
 *   No incluye lo que el cliente ya dio (`anio`, `cilindrada`): el SQL ya filtró
 *   por eso y preguntarlo de nuevo sería absurdo. Un candidato que no declara un
 *   atributo no cuenta para ese atributo: "no sabemos" no es una diferencia. Dos
 *   candidatos difieren si los CONJUNTOS de valores que declaran difieren.
 * - Pieza: entre TODOS los candidatos con evidencia de vehículo comparable a la
 *   del mejor (hasta `TOLERANCIA_NIVEL` por debajo) y puntaje parecido. Si son de
 *   piezas distintas (el termostato suelto y el conjunto armado), hay que
 *   preguntar cuál antes de dar precios.
 * - Procedencia: si una misma pieza viene con más de una (MOBIS, KOREA), se
 *   informa. No es una pregunta: el agente ofrece cada una con su precio.
 *
 * `null` si no hay nada que preguntar ni que ofrecer.
 */
export function diferenciasEntre(
  hits: readonly CandidatoParaDiferencias[],
  dado: { anio?: number | undefined; cilindrada?: string | undefined },
  marcas?: IndiceMarcas,
): Diferencias | null {
  if (hits.length < 2) return null;

  const atributos: AtributoQueDifiere[] = [];
  const valores: Partial<Record<AtributoQueDifiere, string[]>> = {};

  const { piezas, procedencias } = piezasYProcedencias(hits, marcas);
  if (piezas.length > 1) {
    atributos.push("pieza");
    valores.pieza = piezas;
  }

  const mejor = Math.max(...hits.map((h) => h.puntaje));
  const candidatos = [...hits]
    .sort((a, b) => nivelDe(b) - nivelDe(a) || b.puntaje - a.puntaje)
    .slice(0, TOPE_CANDIDATOS_DIFERENCIAS)
    .filter((h) => mejor <= 0 || h.puntaje >= mejor * FRACCION_PUNTAJE_MINIMA);

  if (candidatos.length >= 2) {
    const porCandidato = candidatos.map((c) => etiquetasDeCompatibilidad(c.compatibilidad));
    const evaluar: AtributoDeCompatibilidad[] = ["anio", "cilindrada", "combustible"];
    for (const atributo of evaluar) {
      if (atributo === "anio" && dado.anio !== undefined) continue;
      if (atributo === "cilindrada" && dado.cilindrada !== undefined) continue;

      const conDato = porCandidato.map((p) => p[atributo]).filter((v) => v.length > 0);
      const firmas = new Set(conDato.map((v) => v.join("|")));
      if (firmas.size < 2) continue;

      atributos.push(atributo);
      // Unión conservando el orden del primer candidato que la trae (los años ya
      // vienen ordenados por candidato; se reordenan abajo).
      const union = new Set<string>();
      for (const v of conDato) for (const x of v) union.add(x);
      valores[atributo] = ordenar(atributo, [...union]);
    }
  }

  if (atributos.length === 0 && procedencias.length === 0) return null;
  return construirDiferencias(atributos, valores, procedencias);
}

/**
 * Las piezas distintas y las procedencias repetidas entre los candidatos con
 * evidencia de vehículo comparable a la del mejor. Los dos en el orden en que
 * aparecen, que es el del ranking.
 */
function piezasYProcedencias(
  hits: readonly CandidatoParaDiferencias[],
  marcas: IndiceMarcas | undefined,
): {
  piezas: string[];
  procedencias: string[];
} {
  const mejorNivel = Math.max(...hits.map(nivelDe));
  const comparables = hits.filter((h) => nivelDe(h) >= mejorNivel - TOLERANCIA_NIVEL);
  const mejorPuntaje = Math.max(...comparables.map((h) => h.puntaje));
  const relevantes = comparables.filter(
    (h) => mejorPuntaje <= 0 || h.puntaje >= mejorPuntaje * FRACCION_PUNTAJE_PIEZA,
  );

  const piezas: string[] = [];
  // Procedencias distintas por pieza (la pieza sin etiqueta cuenta como una sola).
  const porPieza = new Map<string, string[]>();
  for (const h of relevantes) {
    const pieza = etiquetaDePieza(h.categoria, h.nombre);
    if (pieza !== null && !piezas.includes(pieza)) piezas.push(pieza);
    const procedencia = etiquetaDeOrigen(resolverOrigen(h.descripcion, h.codigo_fabrica, marcas));
    if (procedencia === null) continue;
    const clave = pieza ?? "";
    const vistas = porPieza.get(clave) ?? [];
    if (!vistas.includes(procedencia)) vistas.push(procedencia);
    porPieza.set(clave, vistas);
  }

  const procedencias: string[] = [];
  for (const vistas of porPieza.values()) {
    if (vistas.length < 2) continue;
    for (const p of vistas) if (!procedencias.includes(p)) procedencias.push(p);
  }
  return { piezas, procedencias };
}

function ordenar(atributo: AtributoDeCompatibilidad, vs: string[]): string[] {
  if (atributo !== "anio") return vs.sort();
  const clave = (t: string): number => {
    if (t.startsWith("hasta ")) return Number.NEGATIVE_INFINITY;
    const n = Number.parseInt(t, 10);
    return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
  };
  return vs.sort((a, b) => clave(a) - clave(b) || a.localeCompare(b));
}
