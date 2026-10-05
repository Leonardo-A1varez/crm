/**
 * Traduce la `Descripcion` comprimida del catálogo (`HY ACC 06- 1.4 /0 XCITE
 * GETZ 1.4`) a una lista de vehículos compatibles con marca, modelo, años,
 * cilindrada y combustible. Las reglas de lectura salen de
 * `docs/catalogo/como-leer-el-catalogo.md`; las siglas de modelo, del
 * diccionario `docs/catalogo/diccionario-modelos-sugerido.csv`.
 *
 * Función pura y sin dependencias: la importa también un script de Node plano
 * (`scripts/catalogo/rellenar-compatibilidad.mjs`), así que usa solo sintaxis
 * TypeScript borrable (sin enums ni propiedades de parámetro).
 *
 * Criterio: lo que no se reconoce se ignora, nunca se inventa. Un nombre sin
 * ningún modelo del diccionario devuelve `[]`.
 */

export type Combustible = "GAS" | "DSL";
export type ConfianzaModelo = "alta" | "media" | "baja";

export interface ModeloDiccionario {
  /** Sigla de marca del catálogo: `HY`, `KIA`, `MT`... */
  marcaSigla: string;
  /** Nombre completo de la marca según la sigla: `Hyundai`. */
  marca: string;
  /** Cómo está escrito en el catálogo: `ACC`, `STA FE`, `TUCS IX`. */
  modeloCatalogo: string;
  /** `modelo`, `submodelo`, `REVISAR` o `ALCANCE` (TODOS/TODAS). */
  tipo: string;
  filas: number;
  /** Nombre unificado del modelo: `Hyundai Accent`. */
  modeloSugerido: string;
  confianza: ConfianzaModelo;
  /** `false` para motores (`4ZE1`), acabados (`XCITE`) y filas sin significado claro. */
  esVehiculo: boolean;
  /** `true` si la entrada junta dos vehículos (`Chevrolet Spark + Daewoo Matiz`). */
  compuesto: boolean;
}

export interface Compatibilidad {
  /** Marca completa derivada de la sigla del modelo: `Hyundai`. */
  marca: string;
  /** Sigla del modelo tal como está en el catálogo: `ACC`. */
  modelo: string;
  /** Nombre unificado del modelo (el de todas sus variantes de escritura). */
  modelo_nombre: string;
  anio_desde: number | null;
  anio_hasta: number | null;
  /** Litros con un decimal: `"1.6"`. */
  cilindrada: string | null;
  combustible: Combustible | null;
}

// ---------------------------------------------------------------------------
// Diccionario
// ---------------------------------------------------------------------------

const CONFIANZAS: ReadonlySet<string> = new Set(["alta", "media", "baja"]);

// Filas del diccionario que no son un vehículo: motores ("MOTOR Isuzu 2.3, NO es
// un modelo"), acabados, marcas sueltas y caracteres rotos.
const NO_VEHICULO =
  /NO es un modelo|^motor\b|\?\?\?|^acabado|^lexus|referencia a motores|carácter roto/i;

/** Parser CSV mínimo: BOM, comillas con `""`, comas y saltos de línea dentro de comillas. */
function parsearCsv(texto: string): string[][] {
  const limpio = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio.charAt(i);
    if (entreComillas) {
      if (c === '"') {
        if (limpio.charAt(i + 1) === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio.charAt(i + 1) === "\n") i++;
      fila.push(campo);
      campo = "";
      filas.push(fila);
      fila = [];
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((x) => x.trim() !== ""));
}

/**
 * Lee `diccionario-modelos-sugerido.csv`. Si el dueño escribió el modelo real
 * (`MODELO_REAL_ESCRIBIR_ACA`) gana sobre el sugerido. Conserva la confianza:
 * quien llama decide con cuáles trabaja (ver `soloConfianzaAlta`).
 */
export function cargarDiccionario(csvText: string): ModeloDiccionario[] {
  const filas = parsearCsv(csvText);
  const cabecera = filas[0];
  if (!cabecera) return [];
  const col = (nombre: string): number => cabecera.findIndex((h) => h.trim() === nombre);
  const iSigla = col("marca_sigla");
  const iMarca = col("marca");
  const iModelo = col("modelo_en_catalogo");
  const iTipo = col("tipo");
  const iFilas = col("filas");
  const iReal = col("MODELO_REAL_ESCRIBIR_ACA");
  const iSugerido = col("MODELO_SUGERIDO");
  const iConfianza = col("CONFIANZA");
  if ([iSigla, iMarca, iModelo, iTipo, iFilas, iSugerido, iConfianza].some((i) => i < 0)) {
    throw new Error("El diccionario no tiene las columnas esperadas del CSV sugerido");
  }

  const salida: ModeloDiccionario[] = [];
  for (const f of filas.slice(1)) {
    const sigla = (f[iSigla] ?? "").trim().toUpperCase();
    const modeloCatalogo = (f[iModelo] ?? "").trim().toUpperCase();
    if (sigla === "" || modeloCatalogo === "") continue;
    const real = iReal >= 0 ? (f[iReal] ?? "").trim() : "";
    const modeloSugerido = real !== "" ? real : (f[iSugerido] ?? "").trim();
    const confianzaCruda = (f[iConfianza] ?? "").trim().toLowerCase();
    salida.push({
      marcaSigla: sigla,
      marca: (f[iMarca] ?? "").trim(),
      modeloCatalogo,
      tipo: (f[iTipo] ?? "").trim(),
      filas: Number((f[iFilas] ?? "0").trim()) || 0,
      modeloSugerido,
      confianza: CONFIANZAS.has(confianzaCruda) ? (confianzaCruda as ConfianzaModelo) : "baja",
      esVehiculo: modeloSugerido !== "" && !NO_VEHICULO.test(modeloSugerido),
      compuesto: modeloSugerido.includes(" + "),
    });
  }
  return salida;
}

export function soloConfianzaAlta(diccionario: ModeloDiccionario[]): ModeloDiccionario[] {
  return diccionario.filter((m) => m.confianza === "alta");
}

// ---------------------------------------------------------------------------
// Índice por clave
// ---------------------------------------------------------------------------

interface Indice {
  /** sigla de marca -> nombre de marca. */
  marcas: Map<string, string>;
  /** `ACC`, `STA FE`... -> entradas con esa escritura (puede haber una por marca). */
  porClave: Map<string, ModeloDiccionario[]>;
  /** Mayor cantidad de palabras de una clave. */
  maxPalabras: number;
}

const cacheIndices = new WeakMap<ModeloDiccionario[], Indice>();

function construirIndice(diccionario: ModeloDiccionario[]): Indice {
  const enCache = cacheIndices.get(diccionario);
  if (enCache) return enCache;
  const marcas = new Map<string, string>();
  const porClave = new Map<string, ModeloDiccionario[]>();
  let maxPalabras = 1;
  for (const m of diccionario) {
    if (!marcas.has(m.marcaSigla)) marcas.set(m.marcaSigla, m.marca);
    // TODOS/TODAS es un modificador de alcance y los compuestos ("Spark + Matiz")
    // se resuelven por sus modelos sueltos: ninguno entra al índice.
    if (m.tipo === "ALCANCE" || m.compuesto) continue;
    const clave = m.modeloCatalogo.replace(/\s+/g, " ");
    const lista = porClave.get(clave);
    if (lista) lista.push(m);
    else porClave.set(clave, [m]);
    maxPalabras = Math.max(maxPalabras, clave.split(" ").length);
  }
  const indice = { marcas, porClave, maxPalabras };
  cacheIndices.set(diccionario, indice);
  return indice;
}

// ---------------------------------------------------------------------------
// Atomización: cada elemento reconocible por su forma queda en su propio token
// ---------------------------------------------------------------------------

const COMBUSTIBLES: Readonly<Record<string, Combustible>> = {
  DSL: "DSL",
  DIESEL: "DSL",
  CRDI: "DSL",
  GAS: "GAS",
  GASOLINA: "GAS",
};

function esConocido(indice: Indice, token: string): boolean {
  return indice.porClave.has(token) || token in COMBUSTIBLES;
}

/** Parte un token pegado (`L200/92-`, `SORENT06-09`, `TRACKER1.8`...) en sus elementos. */
function expandir(token: string, indice: Indice, salida: string[]): void {
  const t = token.replace(/[,;]+$/, "");
  if (t === "") return;

  // Sobremedida suelta (`/0`): no aporta a la compatibilidad.
  if (/^\/\d$/.test(t)) return;

  // Sobremedida pegada (`SPORTAG/0`, `17-/0`, `HR16/1`): se quita y se sigue con el resto.
  const conMedida = /^(.+)\/\d$/.exec(t);
  if (conMedida?.[1]) return expandir(conMedida[1], indice, salida);

  // Modelo y año pegados con barra (`L200/92-`).
  const barraAnio = /^(.+)\/(\d{2}-\d{0,2}|-\d{2})$/.exec(t);
  if (barraAnio?.[1] && barraAnio[2]) {
    expandir(barraAnio[1], indice, salida);
    salida.push(barraAnio[2]);
    return;
  }

  // Rango de cilindradas (`1.3-1.8`).
  const rangoCc = /^(\d\.\d)-(\d\.\d)$/.exec(t);
  if (rangoCc?.[1] && rangoCc[2]) {
    salida.push(rangoCc[1], rangoCc[2]);
    return;
  }

  // Dos modelos (o dos combustibles) en un token: `VERACRUZ/SORENT`, `DSL/GAS`.
  const dosPalabras = /^([A-Z]{3,})\/([A-Z]{3,})$/.exec(t);
  if (dosPalabras?.[1] && dosPalabras[2]) {
    if (esConocido(indice, dosPalabras[1]) && esConocido(indice, dosPalabras[2])) {
      salida.push(dosPalabras[1], dosPalabras[2]);
      return;
    }
  }

  // Modelo con un año o un guion colgado: `H1-06`, `SORENT06-09`, `VER-`.
  const conAnio = /^([A-Z][A-Z0-9]*?)(-\d{2}|\d{2}-\d{2}|-)$/.exec(t);
  if (conAnio?.[1] && conAnio[2] && indice.porClave.has(conAnio[1])) {
    salida.push(conAnio[1]);
    if (conAnio[2] !== "-") salida.push(conAnio[2]);
    return;
  }

  // Modelo con la cilindrada pegada: `TRACKER1.8`.
  const conCc = /^([A-Z]{4,})(\d\.\d)$/.exec(t);
  if (conCc?.[1] && conCc[2] && indice.porClave.has(conCc[1])) {
    salida.push(conCc[1], conCc[2]);
    return;
  }

  salida.push(t);
}

function atomizar(nombre: string, indice: Indice): string[] {
  const normalizado = nombre
    .toUpperCase()
    // `04 - 07` y `89 -` con espacios: se pegan para que sean un solo token.
    .replace(/(?<![\d.])(\d{2})\s+-\s+(\d{2})(?=\s|$)/g, "$1-$2")
    .replace(/(?<![\d.])(\d{2})\s+-(?=\s|$)/g, "$1-");
  const salida: string[] = [];
  for (const crudo of normalizado.split(/\s+/)) {
    if (crudo !== "") expandir(crudo, indice, salida);
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Formas numéricas
// ---------------------------------------------------------------------------

/**
 * Regla de siglo (§7.1): >= 50 es 19XX y < 50 es 20XX. El catálogo no tiene
 * ningún año entre 39 y 71, así que lo que cae en 40-69 no es un año (es una
 * medida, un código) y se rechaza en vez de adivinar.
 */
function anioDeDosDigitos(aa: string): number | null {
  const n = Number(aa);
  if (n >= 40 && n < 70) return null;
  return n >= 50 ? 1900 + n : 2000 + n;
}

function parsearAnios(atomo: string): { desde: number | null; hasta: number | null } | null {
  const desde = /^(\d{2})-$/.exec(atomo);
  if (desde?.[1]) {
    const d = anioDeDosDigitos(desde[1]);
    return d === null ? null : { desde: d, hasta: null };
  }
  const hasta = /^-(\d{2})$/.exec(atomo);
  if (hasta?.[1]) {
    const h = anioDeDosDigitos(hasta[1]);
    return h === null ? null : { desde: null, hasta: h };
  }
  const rango = /^(\d{2})-(\d{2})$/.exec(atomo);
  if (rango?.[1] && rango[2]) {
    const d = anioDeDosDigitos(rango[1]);
    const h = anioDeDosDigitos(rango[2]);
    if (d === null || h === null || h < d) return null;
    return { desde: d, hasta: h };
  }
  return null;
}

/** `1.6` y `1.0T` son cilindradas; `60.3`, `3&4` o `2DA` no. */
function parsearCilindrada(atomo: string): string | null {
  const m = /^(\d\.\d)T?$/.exec(atomo);
  if (!m?.[1]) return null;
  const litros = Number(m[1]);
  return litros >= 0.6 && litros <= 7 ? m[1] : null;
}

function esMm(atomo: string | undefined): boolean {
  return atomo !== undefined && /^MM\.?$/.test(atomo);
}

// ---------------------------------------------------------------------------
// Búsqueda de modelos
// ---------------------------------------------------------------------------

/**
 * Palabras que son una sigla de modelo en alguna marca pero que, fuera de su
 * propia marca, casi siempre significan otra cosa (SEN = sensor, VAN, GRAN...).
 * Solo se descartan al buscar en una marca distinta a la del contexto.
 */
const AMBIGUAS_ENTRE_MARCAS: ReadonlySet<string> = new Set([
  "NEW",
  "GRAN",
  "GRAND",
  "VAN",
  "SAN",
  "SPORT",
  "RUN",
  "HI",
  "LC",
  "HD",
  "SEN",
  "RP",
]);

interface Coincidencia {
  entrada: ModeloDiccionario;
  palabras: number;
}

function mejorPorFilas(lista: ModeloDiccionario[]): ModeloDiccionario | undefined {
  let mejor: ModeloDiccionario | undefined;
  for (const m of lista) if (!mejor || m.filas > mejor.filas) mejor = m;
  return mejor;
}

/** Coincidencia más larga a partir de `i`; dentro de un largo, gana la marca del contexto. */
function buscarModelo(
  indice: Indice,
  atomos: string[],
  i: number,
  contexto: string | null,
): Coincidencia | null {
  const tope = Math.min(indice.maxPalabras, atomos.length - i);
  for (let n = tope; n >= 1; n--) {
    const clave = atomos.slice(i, i + n).join(" ");
    const candidatas = indice.porClave.get(clave);
    if (!candidatas) continue;
    const propia = mejorPorFilas(candidatas.filter((c) => c.marcaSigla === contexto));
    if (propia) return { entrada: propia, palabras: n };
    // Otra marca (compatibles que cruzan marcas, o nombre sin sigla inicial):
    // una palabra sola exige 3+ letras, no ser un número ni una palabra ambigua.
    if (n === 1 && (clave.length < 3 || /^\d+$/.test(clave) || AMBIGUAS_ENTRE_MARCAS.has(clave))) {
      continue;
    }
    const ajena = mejorPorFilas(candidatas);
    if (ajena) return { entrada: ajena, palabras: n };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Traducción
// ---------------------------------------------------------------------------

interface Grupo {
  marca: string;
  modelo: string;
  modeloNombre: string;
  desde: number | null;
  hasta: number | null;
  conAnios: boolean;
  cilindradas: string[];
  combustibles: Set<Combustible>;
}

function nuevoGrupo(marca: string, modelo: string, modeloNombre: string): Grupo {
  return {
    marca,
    modelo,
    modeloNombre,
    desde: null,
    hasta: null,
    conAnios: false,
    cilindradas: [],
    combustibles: new Set(),
  };
}

function emitir(grupo: Grupo): Compatibilidad[] {
  const combustible = grupo.combustibles.size === 1 ? ([...grupo.combustibles][0] ?? null) : null;
  const cilindradas = grupo.cilindradas.length > 0 ? grupo.cilindradas : [null];
  return cilindradas.map((cilindrada) => ({
    marca: grupo.marca,
    modelo: grupo.modelo,
    modelo_nombre: grupo.modeloNombre,
    anio_desde: grupo.desde,
    anio_hasta: grupo.hasta,
    cilindrada,
    combustible,
  }));
}

/**
 * Traduce un `nombre` del catálogo a los vehículos donde sirve la pieza.
 *
 * - El primer vehículo recibe los años, la cilindrada y el combustible que le
 *   siguen; cada modelo compatible de la cola recibe los suyos si los trae
 *   pegados, y si no queda con `null`. Un año ya asignado no se pisa.
 * - Una sigla de marca a mitad de texto cambia la marca; repetir la marca en
 *   curso no corta el vehículo. `MT` solo es Mitsubishi si abre un modelo.
 * - `MARCA TODOS` es toda la marca (`modelo: "TODOS"`); `MODELO TODOS` es todo
 *   ese modelo y no suma elemento.
 * - Sin ningún modelo del diccionario devuelve `[]`.
 */
export function traducirDescripcion(
  nombre: string,
  diccionario: ModeloDiccionario[],
): Compatibilidad[] {
  const indice = construirIndice(diccionario);
  const atomos = atomizar(nombre, indice);

  const resultado: Compatibilidad[] = [];
  let contexto: string | null = null;
  let grupo: Grupo | null = null;
  let trasMarca = false;

  const cerrar = (): void => {
    if (grupo) resultado.push(...emitir(grupo));
    grupo = null;
  };

  let i = 0;
  while (i < atomos.length) {
    const atomo = atomos[i] ?? "";
    const veniaDeMarca = trasMarca;
    trasMarca = false;

    // Sigla de marca.
    if (indice.marcas.has(atomo)) {
      if (i === 0) {
        contexto = atomo;
        trasMarca = true;
      } else if (atomo !== contexto) {
        // `MT` a mitad de texto es transmisión manual salvo que abra un modelo Mitsubishi.
        let cambia = true;
        if (atomo === "MT") {
          const siguiente = buscarModelo(indice, atomos, i + 1, "MT");
          cambia = siguiente?.entrada.marcaSigla === "MT" && siguiente.entrada.esVehiculo;
        }
        if (cambia) {
          cerrar();
          contexto = atomo;
          trasMarca = true;
        }
      }
      i++;
      continue;
    }

    // Años.
    const anios = parsearAnios(atomo);
    if (anios) {
      if (!esMm(atomos[i + 1]) && grupo && !grupo.conAnios) {
        grupo.desde = anios.desde;
        grupo.hasta = anios.hasta;
        grupo.conAnios = true;
      }
      i++;
      continue;
    }

    // Cilindrada.
    const cilindrada = parsearCilindrada(atomo);
    if (cilindrada) {
      if (!esMm(atomos[i + 1]) && grupo && !grupo.cilindradas.includes(cilindrada)) {
        grupo.cilindradas.push(cilindrada);
      }
      i++;
      continue;
    }

    // Combustible.
    const combustible = COMBUSTIBLES[atomo];
    if (combustible) {
      grupo?.combustibles.add(combustible);
      i++;
      continue;
    }

    // Alcance: toda la marca si va pegado a la sigla, o modificador del modelo anterior.
    if (atomo === "TODOS" || atomo === "TODAS") {
      const marca = contexto ? indice.marcas.get(contexto) : undefined;
      if (!grupo && veniaDeMarca && marca) grupo = nuevoGrupo(marca, "TODOS", "Todos");
      i++;
      continue;
    }

    // Modelo.
    const coincidencia = buscarModelo(indice, atomos, i, contexto);
    if (coincidencia) {
      if (coincidencia.entrada.esVehiculo) {
        cerrar();
        const e = coincidencia.entrada;
        grupo = nuevoGrupo(e.marca, e.modeloCatalogo, e.modeloSugerido);
      }
      i += coincidencia.palabras;
      continue;
    }

    i++;
  }
  cerrar();

  // El mismo vehículo mencionado dos veces igual cuenta una vez.
  const vistos = new Set<string>();
  return resultado.filter((c) => {
    const clave = JSON.stringify(c);
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}
