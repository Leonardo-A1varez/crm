import { plegarTexto } from "@/lib/catalogo/plegar-texto";

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
export interface ElementoCompatibilidad {
  marca: string;
  modelo: string;
  anio_desde?: number | null;
  anio_hasta?: number | null;
  /** En litros con un decimal: "1.6". */
  cilindrada?: string | null;
  /** "GAS" o "DSL". */
  combustible?: string | null;
  /**
   * El nombre unificado del diccionario ("Kia Picanto"): PIC, PICANT y PICANTO son
   * siglas distintas del mismo modelo. Lo escribe el traductor del inventario.
   */
  modelo_nombre?: string | null;
  motor?: string;
}

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
    salida.push({
      marca,
      modelo,
      anio_desde: numeroONulo(r["anio_desde"]),
      anio_hasta: numeroONulo(r["anio_hasta"]),
      cilindrada: textoONulo(r["cilindrada"]),
      combustible: textoONulo(r["combustible"]),
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
    const coincide =
      sigla === m ||
      nombre === m ||
      clave === m ||
      resto === m ||
      // "tucson" sirve para "tucson 1a gen (jm)". Comparación literal, no LIKE:
      // un `%` escrito por el cliente no es un comodín.
      clave.slice(0, m.length + 1) === `${m} ` ||
      resto.slice(0, m.length + 1) === `${m} ` ||
      c.alias.some((a) => plegarTexto(a) === m);
    if (coincide) salida.set(`${marcaC}|${sigla}`, { marca: marcaC, sigla, nombre });
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
  const marca = nulaSiVacia(filtro.marca);
  const modelo = nulaSiVacia(filtro.modelo);
  const anio = filtro.anio;
  const cilindrada = cilindradaDeFiltro(filtro.cilindrada);
  if (marca === null && modelo === null && anio === undefined && cilindrada === null) {
    return [...compatibilidad];
  }
  const modeloResuelto = resueltos.length > 0;

  return compatibilidad.filter((e) => {
    const marcaE = plegarTexto(e.marca);
    const modeloE = plegarTexto(e.modelo);
    const nombreE = e.modelo_nombre ? plegarTexto(e.modelo_nombre) : null;
    // `MARCA TODOS` del inventario: sirve para cualquier modelo de la marca.
    const esTodos = modeloE === "todos";

    let vehiculoOk: boolean;
    if (modelo === null) {
      vehiculoOk = marca === null || marcaE === marca;
    } else if (modeloResuelto) {
      vehiculoOk = resueltos.some(
        (r) => r.marca === marcaE && (r.sigla === modeloE || r.nombre === nombreE || esTodos),
      );
    } else {
      vehiculoOk =
        (marca === null || marcaE === marca) &&
        (modeloE === modelo ||
          nombreE === modelo ||
          (marca !== null && esTodos) ||
          textoProducto.includes(modelo));
    }
    if (!vehiculoOk) return false;

    if (anio !== undefined) {
      if (e.anio_desde !== null && e.anio_desde !== undefined && anio < e.anio_desde) return false;
      if (e.anio_hasta !== null && e.anio_hasta !== undefined && anio > e.anio_hasta) return false;
    }
    if (cilindrada !== null && tieneValor(e.cilindrada) && e.cilindrada !== cilindrada) {
      return false;
    }
    return true;
  });
}

/**
 * Si el producto entra en el resultado para ese vehículo, y con qué elementos.
 * `null` si no entra.
 *
 * Una `compatibilidad` vacía significa "no sabemos", no "no sirve": entra
 * siempre, con la lista vacía.
 */
export function compatibilidadParaVehiculo(
  compatibilidad: readonly ElementoCompatibilidad[],
  filtro: FiltroVehiculo,
  resueltos: readonly ModeloResuelto[],
  textoProducto: string,
): ElementoCompatibilidad[] | null {
  if (compatibilidad.length === 0) return [];
  const elementos = elementosCompatibles(compatibilidad, filtro, resueltos, textoProducto);
  return elementos.length > 0 ? elementos : null;
}

// ───────────────────────── Diferencias entre candidatos ─────────────────────────

export type AtributoQueDifiere = "anio" | "cilindrada" | "combustible";

export interface Diferencias {
  /** Los atributos en los que los mejores candidatos no coinciden. */
  atributos: AtributoQueDifiere[];
  /** Los valores que aparecen, solo de los atributos que difieren. */
  valores: Partial<Record<AtributoQueDifiere, string[]>>;
  /**
   * Lo que el agente tiene que hacer con esto, dicho en el propio resultado de la
   * herramienta. En el prompt solo, un modelo chico lista igual los candidatos con
   * sus precios; pegada a los datos, la instrucción se obedece mucho más.
   */
  instruccion: string;
}

const NOMBRE_ATRIBUTO: Record<AtributoQueDifiere, string> = {
  anio: "el año",
  cilindrada: "la cilindrada",
  combustible: "el combustible (diésel o gasolina)",
};

/** Arma `Diferencias` con su instrucción. */
export function construirDiferencias(
  atributos: AtributoQueDifiere[],
  valores: Partial<Record<AtributoQueDifiere, string[]>>,
): Diferencias {
  const que = atributos.map((a) => NOMBRE_ATRIBUTO[a]).join(" y ");
  return {
    atributos,
    valores,
    instruccion:
      `Hay más de una versión y se diferencian en: ${que}. ` +
      `Preguntale al cliente ${que} antes de dar precios: no listes ni cotices los candidatos todavía.`,
  };
}

/** Cuántos de los primeros resultados se comparan. */
export const TOPE_CANDIDATOS_DIFERENCIAS = 5;
/** Un candidato con menos de esta fracción del mejor puntaje es ruido, no alternativa. */
export const FRACCION_PUNTAJE_MINIMA = 0.5;

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
): Record<AtributoQueDifiere, string[]> {
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

export interface CandidatoParaDiferencias {
  puntaje: number;
  compatibilidad: readonly ElementoCompatibilidad[];
}

/**
 * En qué se diferencian los mejores candidatos, para que el agente pregunte solo
 * ese atributo en vez de elegir uno.
 *
 * - Compara hasta `TOPE_CANDIDATOS_DIFERENCIAS` resultados con puntaje cercano
 *   al mejor.
 * - No incluye lo que el cliente ya dio (`anio`, `cilindrada`): el SQL ya filtró
 *   por eso y preguntarlo de nuevo sería absurdo.
 * - Un candidato que no declara un atributo no cuenta para ese atributo: "no
 *   sabemos" no es una diferencia.
 * - Dos candidatos difieren si los CONJUNTOS de valores que declaran difieren:
 *   uno que sirve para 1.4 y 1.6 se distingue de otro que solo sirve para 1.6.
 *
 * `null` si no hay nada que preguntar.
 */
export function diferenciasEntre(
  hits: readonly CandidatoParaDiferencias[],
  dado: { anio?: number | undefined; cilindrada?: string | undefined },
): Diferencias | null {
  if (hits.length < 2) return null;
  const mejor = Math.max(...hits.map((h) => h.puntaje));
  const candidatos = [...hits]
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, TOPE_CANDIDATOS_DIFERENCIAS)
    .filter((h) => mejor <= 0 || h.puntaje >= mejor * FRACCION_PUNTAJE_MINIMA);
  if (candidatos.length < 2) return null;

  const porCandidato = candidatos.map((c) => etiquetasDeCompatibilidad(c.compatibilidad));
  const atributos: AtributoQueDifiere[] = [];
  const valores: Partial<Record<AtributoQueDifiere, string[]>> = {};

  const evaluar: AtributoQueDifiere[] = ["anio", "cilindrada", "combustible"];
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
  return atributos.length === 0 ? null : construirDiferencias(atributos, valores);
}

function ordenar(atributo: AtributoQueDifiere, vs: string[]): string[] {
  if (atributo !== "anio") return vs.sort();
  const clave = (t: string): number => {
    if (t.startsWith("hasta ")) return Number.NEGATIVE_INFINITY;
    const n = Number.parseInt(t, 10);
    return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
  };
  return vs.sort((a, b) => clave(a) - clave(b) || a.localeCompare(b));
}
