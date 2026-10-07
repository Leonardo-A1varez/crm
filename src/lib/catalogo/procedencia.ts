import { plegarTexto } from "@/lib/catalogo/plegar-texto";

/**
 * La marca y la procedencia de un producto, que el ERP mezcla en un solo campo.
 *
 * En el ERP vive en `descripcion_auxiliar` (en la tabla, `productos.descripcion`)
 * y junto a las MARCAS (MOBIS, GM, MANDO, CTR, JUNGWOO…) trae PAÍSES (CHINA,
 * KOREA, COLOMBIA, HY INDIA…), medidas (`52*88C`, `54*88°`), sobremedidas
 * (`+20`, `STD`), cantidades y restos (`C/U`). El ERP no tiene una columna de
 * origen: lo que sabemos de dónde viene una marca está en `catalogo_marcas`
 * (la carga Bodega Web), y el código de fábrica trae a veces un sufijo
 * (`/K` Korea, `/JP` Japón…).
 *
 * Cotizar «52*88C $11,23» sería inventarle un origen a la pieza, así que la
 * resolución solo afirma lo que una de esas tres fuentes dice, en este orden.
 * Ver `resolverOrigen`.
 */

/** Una fila de `catalogo_marcas`. */
export interface MarcaCatalogo {
  nombre: string;
  tipo: string | null;
  /** País u «ORIGINAL». `null` si no se sabe. */
  procedencia: string | null;
  activa: boolean;
  alias: readonly string[];
}

/** Lo que se sabe del origen de una pieza. `null` es «no sabemos», nunca un default. */
export interface OrigenDeLaPieza {
  /** La marca por su nombre canónico (MOBIS, JUNGWOO…), o el texto de marca desconocida. */
  marca: string | null;
  /** Como se le dice al cliente: «Original», «Korea», «Japón»… */
  procedencia: string | null;
}

/** Marcas listas para resolver: la clave es el nombre o un alias, plegado. */
export interface IndiceMarcas {
  readonly porClave: ReadonlyMap<string, { nombre: string; procedencia: string | null }>;
}

/** Marcadores de sobremedida que son solo letras y se colarían como marca. */
const NO_ES_PROCEDENCIA = new Set(["STD"]);

const SOLO_LETRAS = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .-]*$/;

/**
 * El texto de marca o procedencia en mayúsculas, o `null` si no es uno (vacío o
 * basura: medidas, cantidades, sobremedidas). Es el filtro de lo que se puede
 * mostrar cuando el texto no es ni un país ni una marca conocida.
 */
export function procedenciaDe(descripcion: string | null | undefined): string | null {
  const t = (descripcion ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  if (t === "" || t.length > 24) return null;
  if (!SOLO_LETRAS.test(t)) return null;
  if (NO_ES_PROCEDENCIA.has(t)) return null;
  return t;
}

/** Plegado para comparar: sin tildes, minúsculas, blancos colapsados. */
const plegar = (t: string): string => plegarTexto(t.trim().replace(/\s+/g, " "));

/**
 * Países y «Original», por su texto plegado, con cómo se le dicen al cliente. Es
 * lo único que se reconoce como país en `descripcion`; un país que no esté acá
 * pasa por el paso de las marcas y termina como texto desconocido, sin inventar.
 */
const PROCEDENCIAS: ReadonlyMap<string, string> = new Map([
  ["original", "Original"],
  ["china", "China"],
  ["korea", "Korea"],
  ["koreano", "Korea"],
  ["corea", "Korea"],
  ["japon", "Japón"],
  ["japan", "Japón"],
  ["colombia", "Colombia"],
  ["india", "India"],
  ["hy india", "India"],
  ["taiwan", "Taiwán"],
  ["alemania", "Alemania"],
  ["francia", "Francia"],
  ["brasil", "Brasil"],
  ["usa", "USA"],
]);

/** Sufijos de origen del código de fábrica (docs/catalogo/como-leer-el-catalogo.md §8.bis). */
const SUFIJOS_DE_ORIGEN: ReadonlyMap<string, string> = new Map([
  ["org", "Original"],
  ["k", "Korea"],
  ["kr", "Korea"],
  ["jp", "Japón"],
  ["fr", "Francia"],
  ["de", "Alemania"],
  ["ch", "China"],
  ["tw", "Taiwán"],
  ["br", "Brasil"],
  ["ind", "India"],
  ["usa", "USA"],
]);

/** Sobremedida del código: `STD`, `0`, `2`, `0.50`, `1.00`. */
const MEDIDA = /^(std|\d{1,2}(\.\d{1,2})?)$/;

const capitalizar = (t: string): string =>
  t.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, c: string) => `${sep}${c.toUpperCase()}`);

/** `ORIGINAL`, `KOREA`, `JAPON` (como guarda la tabla) -> como se le dice al cliente. */
function mostrarProcedencia(procedencia: string): string {
  const t = plegar(procedencia);
  return PROCEDENCIAS.get(t) ?? capitalizar(procedencia.trim().toLowerCase().replace(/\s+/g, " "));
}

/**
 * El origen que dice el sufijo del código de fábrica (`25100-2X000/K`), o `null`.
 * Pela desde el final: la medida puede ir antes o después del origen
 * (`.../K/0.50`, `.../ORG/STD`). Un código sin barra no tiene sufijo.
 */
function procedenciaDelCodigo(codigo: string | null | undefined): string | null {
  const crudo = (codigo ?? "").trim();
  if (crudo === "") return null;
  const segmentos = crudo.split("/").map((s) => plegar(s.replace(/[-\s]+$/, "")));
  let origen: string | null = null;
  while (segmentos.length > 1) {
    const ultimo = segmentos[segmentos.length - 1] ?? "";
    const dice = SUFIJOS_DE_ORIGEN.get(ultimo);
    if (dice !== undefined) {
      origen ??= dice;
    } else if (!MEDIDA.test(ultimo)) {
      break;
    }
    segmentos.pop();
  }
  return origen;
}

/** Arma el índice de marcas activas. El nombre canónico gana sobre el alias de otra marca. */
export function indexarMarcas(marcas: readonly MarcaCatalogo[]): IndiceMarcas {
  const porClave = new Map<string, { nombre: string; procedencia: string | null }>();
  const activas = marcas.filter((m) => m.activa && plegar(m.nombre) !== "");
  const entrada = (m: MarcaCatalogo) => ({
    nombre: m.nombre.trim(),
    procedencia:
      m.procedencia !== null && m.procedencia.trim() !== ""
        ? mostrarProcedencia(m.procedencia)
        : null,
  });
  for (const m of activas) {
    const k = plegar(m.nombre);
    if (!porClave.has(k)) porClave.set(k, entrada(m));
  }
  for (const m of activas) {
    for (const a of m.alias) {
      const k = plegar(a);
      if (k !== "" && !porClave.has(k)) porClave.set(k, entrada(m));
    }
  }
  return { porClave };
}

const SIN_MARCAS: IndiceMarcas = { porClave: new Map() };

/**
 * De dónde viene la pieza y de qué marca es, sin inventar nada:
 *
 * 1. `descripcion` es un país (CHINA, KOREA, HY INDIA…): esa es la procedencia y
 *    no hay marca.
 * 2. `descripcion` es una marca del catálogo (por nombre o alias): la marca es su
 *    nombre canónico y la procedencia, la de `catalogo_marcas` (puede ser
 *    `null`; entonces se usa el sufijo del código si lo trae).
 * 3. Si no, el sufijo del código de fábrica (`/K`, `/JP`, `/FR`, `/DE`, `/CH`,
 *    `/ORG`…) da la procedencia.
 * 4. La marca es el texto de `descripcion` si parece una marca (letras, sin
 *    medidas); si no, no hay marca. La procedencia que no salió de 1 a 3 queda `null`.
 */
export function resolverOrigen(
  descripcion: string | null | undefined,
  codigoFabrica: string | null | undefined,
  indice: IndiceMarcas = SIN_MARCAS,
): OrigenDeLaPieza {
  const t = plegar(descripcion ?? "");
  if (t !== "") {
    const pais = PROCEDENCIAS.get(t);
    if (pais !== undefined) return { marca: null, procedencia: pais };
    const marca = indice.porClave.get(t);
    if (marca !== undefined) {
      return {
        marca: marca.nombre,
        procedencia: marca.procedencia ?? procedenciaDelCodigo(codigoFabrica),
      };
    }
  }
  return { marca: procedenciaDe(descripcion), procedencia: procedenciaDelCodigo(codigoFabrica) };
}

/**
 * Cómo se presenta la opción al cliente, junto al precio: «MOBIS (Original)»,
 * «CHINA» (solo procedencia), «TAIHO» (solo marca). `null` si no se sabe nada.
 */
export function etiquetaDeOrigen(o: OrigenDeLaPieza): string | null {
  if (o.marca !== null && o.procedencia !== null) return `${o.marca} (${o.procedencia})`;
  return o.marca ?? o.procedencia;
}
