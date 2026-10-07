import { expandirFrase, type IndiceAbreviaturas } from "@/lib/catalogo/abreviaturas";
import { palabrasDePieza, type ConsultaDePieza } from "@/lib/catalogo/categoria";
import { plegarTexto } from "@/lib/catalogo/plegar-texto";

/**
 * El texto de una cotización que el agente solo copia.
 *
 * OBSERVACION: el modelo barato armaba la cotización con sus palabras y mezclaba
 * "(IVA incluido)" en cada línea, nombraba las piezas relacionadas con el nombre
 * crudo del ERP («POLEA BOMBA AGUA E HIDRAU») y tuteaba al cliente. CAUSA RAIZ: le
 * dábamos los datos y una instrucción en prosa; la redacción quedaba a su criterio.
 * FIX: la herramienta entrega el encabezado y la línea de piezas relacionadas ya
 * escritos (de usted), de forma determinística.
 */

const FILLER = new Set(["de", "del", "la", "el", "y", "e", "con", "para", "en", "a"]);
const CONECTORES_DE_CORTE = new Set(["y", "e", "con", "para", "en"]);

const CALIFICADORES_DE_CONJUNTO = new Set([
  "armado",
  "armada",
  "armados",
  "armadas",
  "completo",
  "completa",
  "conjunto",
  "kit",
]);

/** Palabras en -a que son masculinas; el resto de las terminadas en -a se tratan como femeninas. */
const MASCULINAS_EN_A = new Set(["sistema", "mapa", "problema", "programa", "diafragma"]);

/**
 * Sustantivos de repuesto con su género y su forma escrita (con tilde). Una palabra que
 * no está aquí cae a la terminación; la tabla existe para los que la terminación no
 * acierta («el rulimán», «la base», «el bocín») y para escribir la tilde.
 */
const SUSTANTIVOS: ReadonlyMap<string, { femenino: boolean; texto: string }> = new Map(
  (
    [
      ["base", "f"],
      ["tapa", "f"],
      ["polea", "f"],
      ["empaque", "m"],
      ["bomba", "f"],
      ["manguera", "f"],
      ["rulimán", "m"],
      ["bocín", "m"],
      ["chaqueta", "f"],
      ["sensor", "m"],
      ["termostato", "m"],
      ["amortiguador", "m"],
      ["filtro", "m"],
      ["radiador", "m"],
      ["disco", "m"],
      ["pastilla", "f"],
      ["banda", "f"],
      ["correa", "f"],
      ["cable", "m"],
      ["bobina", "f"],
      ["bujía", "f"],
      ["válvula", "f"],
      ["junta", "f"],
      ["sello", "m"],
      ["retén", "m"],
      ["soporte", "m"],
      ["bieleta", "f"],
      ["rótula", "f"],
      ["terminal", "m"],
      ["brazo", "m"],
      ["maza", "f"],
      ["balero", "m"],
      ["cojinete", "m"],
      ["cremallera", "f"],
      ["dirección", "f"],
      ["tensor", "m"],
      ["ventilador", "m"],
      ["compresor", "m"],
      ["alternador", "m"],
      ["motor", "m"],
      ["tanque", "m"],
      ["tubo", "m"],
      ["inyector", "m"],
      ["resorte", "m"],
      ["barra", "f"],
      ["estabilizador", "m"],
      ["cadena", "f"],
      ["corona", "f"],
      ["culata", "f"],
      ["rueda", "f"],
      ["agua", "f"],
      ["fuelle", "m"],
      ["tapón", "m"],
      ["perno", "m"],
      ["kit", "m"],
      ["oring", "m"],
    ] as const
  ).map(([texto, g]) => [plegarTexto(texto), { femenino: g === "f", texto }]),
);

/** Abreviaturas del ERP que se leen igual aunque el diccionario del dueño no las traiga. */
const ABREVIATURAS_DE_RESPALDO: Readonly<Record<string, string>> = {
  mang: "manguera",
  rulim: "ruliman",
  amortig: "amortiguador",
  post: "posterior",
  delt: "delantero",
};

/** Modificadores que van pegados a la pieza sin «de»: «amortiguador posterior», «polea tensora». */
const MODIFICADORES = new Set([
  "delantero",
  "trasero",
  "posterior",
  "anterior",
  "izquierdo",
  "derecho",
  "superior",
  "inferior",
  "central",
  "lateral",
  "interno",
  "externo",
  "interior",
  "exterior",
  "completo",
  "armado",
  "universal",
  "original",
  "tensora",
  "loca",
  "guia",
  "doble",
  "simple",
  "largo",
  "corto",
  "grande",
  "pequeno",
]);

function esModificador(palabra: string): boolean {
  if (/\d/.test(palabra)) return true;
  const sinS = palabra.endsWith("s") ? palabra.slice(0, -1) : palabra;
  const sinEs = palabra.endsWith("es") ? palabra.slice(0, -2) : sinS;
  return MODIFICADORES.has(palabra) || MODIFICADORES.has(sinS) || MODIFICADORES.has(sinEs);
}

/** Nombre corto (con artículo) de cada subpieza que detecta `etiquetaDePieza`. */
const SUBPIEZA_CORTA: Readonly<Record<string, string>> = {
  empaque: "el empaque",
  oring: "el o-ring",
  sello: "el sello",
  reten: "el retén",
  perno: "el perno",
  base: "la base",
  tapa: "la tapa",
  kit: "el kit",
};

const singular = (p: string): string => (p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p);

interface Articulado {
  femenino: boolean;
  plural: boolean;
}

function generoDe(palabra: string): Articulado {
  const plural = palabra.length > 3 && palabra.endsWith("s");
  const raiz = singular(palabra);
  const conocido =
    SUSTANTIVOS.get(raiz) ??
    (palabra.endsWith("es") ? SUSTANTIVOS.get(palabra.slice(0, -2)) : undefined);
  if (conocido) return { plural, femenino: conocido.femenino };
  const femenino =
    (raiz.endsWith("a") && !MASCULINAS_EN_A.has(raiz)) ||
    /(cion|sion|dad|tad|tud|umbre)$/.test(raiz);
  return { plural, femenino };
}

/** La palabra con su tilde si es un sustantivo de la tabla («ruliman» -> «rulimán»). */
const conTilde = (p: string): string => SUSTANTIVOS.get(p)?.texto ?? p;

/**
 * «base amortiguador» -> «la base de amortiguador»; «amortiguador posterior» sin «de»
 * (el modificador va pegado); se corta en el primer conector («termostato armado y tapas»
 * -> «el termostato armado»). El artículo concuerda con la cabeza.
 */
function sintagmaNominal(palabras: readonly string[]): string {
  const desde = palabras.findIndex((p) => !FILLER.has(p));
  const util = desde === -1 ? [...palabras] : palabras.slice(desde);
  const corte = util.findIndex((p, i) => i > 0 && CONECTORES_DE_CORTE.has(p));
  const sinCola = corte === -1 ? util : util.slice(0, corte);
  const [cabeza = "", ...resto] = sinCola;
  const sig = resto[0];
  const conDe = sig !== undefined && !FILLER.has(sig) && !esModificador(sig);
  const nombre = [cabeza, ...(conDe ? ["de"] : []), ...resto].map(conTilde).join(" ");
  return `${articulo(generoDe(cabeza))} ${nombre}`;
}

const articulo = (g: Articulado): string =>
  g.plural ? (g.femenino ? "las" : "los") : g.femenino ? "la" : "el";

const palabrasPlegadas = (t: string): string[] =>
  plegarTexto(t)
    .split(/[^0-9a-z/.*-]+/)
    .filter((p) => p.length > 0);

/** `etiqueta` = `CATEGORIA` o `CATEGORIA (sub)` tal como la arma `etiquetaDePieza`. */
function partirEtiqueta(etiqueta: string): { categoria: string; sub: string | undefined } {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(etiqueta.trim());
  return m
    ? { categoria: (m[1] ?? "").trim(), sub: m[2] }
    : { categoria: etiqueta.trim(), sub: undefined };
}

/** La cabeza de una categoría armada: «TERMOSTATO ARMADO Y TAPAS» -> «termostato». */
function cabezaSinCalificadores(categoria: string): string {
  const palabras = palabrasPlegadas(categoria).filter((p) => !CALIFICADORES_DE_CONJUNTO.has(p));
  const corte = palabras.findIndex((p, i) => i > 0 && CONECTORES_DE_CORTE.has(p));
  const cabeza = corte === -1 ? palabras : palabras.slice(0, corte);
  return cabeza.join(" ");
}

/** Las palabras de una categoría del ERP, con las abreviaturas puestas en palabras del cliente. */
function palabrasDeCategoria(categoria: string, indice: IndiceAbreviaturas | undefined): string[] {
  const texto = indice ? expandirFrase(categoria, indice) : categoria;
  return palabrasPlegadas(texto).map((p) => ABREVIATURAS_DE_RESPALDO[p] ?? p);
}

/** Texto de una categoría completa en minúscula, sin calificadores de conjunto. */
function categoriaLegible(categoria: string): string {
  return plegarTexto(categoria).replace(/\s+/g, " ").trim();
}

/**
 * Cómo se nombra, corto y en minúscula con artículo, una pieza relacionada que
 * sigue el formato `CATEGORIA` o `CATEGORIA (subpieza)`.
 */
export function nombreCortoRelacionada(etiqueta: string, consulta?: ConsultaDePieza): string {
  const { categoria, sub } = partirEtiqueta(etiqueta);

  if (sub !== undefined && sub !== "conjunto completo") {
    const corto = SUBPIEZA_CORTA[sub];
    if (corto) return corto;
  }

  if (sub === "conjunto completo") {
    const cabeza = cabezaSinCalificadores(categoria) || categoriaLegible(categoria);
    const primera = palabrasPlegadas(cabeza)[0] ?? cabeza;
    const g = generoDe(primera);
    const completo = g.plural
      ? g.femenino
        ? "completas"
        : "completos"
      : g.femenino
        ? "completa"
        : "completo";
    return `${articulo(g)} ${cabeza} ${completo}`;
  }

  const pedidas = new Set((consulta ? palabrasDePieza(consulta) : []).map(singular));
  const palabras = palabrasDeCategoria(categoria, consulta?.indice);
  const delaCategoria = new Set(palabras.map(singular));
  const contieneLaPedida = pedidas.size > 0 && [...pedidas].every((p) => delaCategoria.has(p));

  // Una categoría que CONTIENE la pieza pedida (`POLEA BOMBA AGUA E HIDRAU` para
  // «bomba de agua») es otra pieza: se quita lo pedido y el ruido del ERP que va
  // tras un conector («polea e hidrau» -> «polea»). Si no la contiene, se nombra entera.
  const sobrantes: string[] = [];
  if (contieneLaPedida) {
    for (const p of palabras) {
      if (CONECTORES_DE_CORTE.has(p) && sobrantes.length > 0) break;
      if (pedidas.has(singular(p)) || FILLER.has(p)) continue;
      sobrantes.push(p);
    }
  }
  // Lo que sobra es solo un modificador («posterior» de AMORTIG POST): la pieza es la entera.
  const usaSobrantes = sobrantes.length > 0 && !esModificador(sobrantes[0] ?? "");
  // Una categoría de una sola palabra viene en plural del ERP («TERMOSTATOS»): se nombra la pieza.
  const entera = palabras.length === 1 ? palabras.map(singular) : palabras;
  return sintagmaNominal(usaSobrantes ? sobrantes : entera);
}

/**
 * La línea que cierra la cotización, de usted. `null` si no hay piezas.
 * «Si necesita la polea o el empaque, también dispongo. ¿Desea que le cotice?»
 */
export function textoRelacionadas(
  etiquetas: readonly string[],
  consulta?: ConsultaDePieza,
): string | null {
  const nombres = [...new Set(etiquetas.map((e) => nombreCortoRelacionada(e, consulta)))];
  if (nombres.length === 0) return null;
  const lista =
    nombres.length === 1
      ? (nombres[0] ?? "")
      : `${nombres.slice(0, -1).join(", ")} o ${nombres[nombres.length - 1] ?? ""}`;
  return `Si necesita ${lista}, también dispongo. ¿Desea que le cotice?`;
}

const capitalizar = (t: string): string => (t === "" ? t : t.charAt(0).toUpperCase() + t.slice(1));

/** Lo que dice el cliente que tiene: modelo (o marca) + año + cilindrada. */
export interface VehiculoDeCotizacion {
  marca?: string | undefined;
  modelo?: string | undefined;
  anio?: number | undefined;
  cilindrada?: string | undefined;
}

/**
 * La primera línea de la cotización: pieza + vehículo y el IVA una sola vez.
 * «Bomba de agua Accent 2006 (IVA incluido):»
 */
export function encabezadoCotizacion(etiqueta: string, vehiculo: VehiculoDeCotizacion): string {
  const { categoria, sub } = partirEtiqueta(etiqueta);
  const cat = categoriaLegible(categoria);
  const palabras = cat.split(" ");

  let pieza: string;
  if (sub === "conjunto completo") {
    const cabeza = cabezaSinCalificadores(categoria) || cat;
    const g = generoDe(palabrasPlegadas(cabeza)[0] ?? cabeza);
    pieza = `${cabeza} ${g.femenino ? "completa" : "completo"}`;
  } else {
    // Una categoría de una sola palabra viene en plural del ERP («TERMOSTATOS»).
    // Con subpieza, la categoría armada («TERMOSTATO ARMADO Y TAPAS (base)») se nombra por su cabeza.
    const cabeza = sub !== undefined ? cabezaSinCalificadores(categoria) : "";
    const base = cabeza !== "" ? cabeza : palabras.length === 1 ? singular(cat) : cat;
    const corto = sub !== undefined ? SUBPIEZA_CORTA[sub] : undefined;
    pieza = corto ? `${corto.replace(/^(el|la) /, "")} de ${base}` : base;
  }

  return encabezadoConPieza(pieza, vehiculo);
}

/** «Bomba de agua Accent 2006 (IVA incluido):» con la pieza ya escrita. */
export function encabezadoConPieza(pieza: string, vehiculo: VehiculoDeCotizacion): string {
  const partes = [
    capitalizar(pieza),
    vehiculo.modelo?.trim() || vehiculo.marca?.trim() || "",
    vehiculo.anio !== undefined && vehiculo.anio > 0 ? String(vehiculo.anio) : "",
    vehiculo.cilindrada?.trim() ?? "",
  ].filter((p) => p !== "");
  return `${partes.join(" ")} (IVA incluido):`;
}

const AFUERA_DE_LA_PIEZA = new Set([
  ...FILLER,
  "necesito",
  "quiero",
  "busco",
  "tiene",
  "tienen",
  "tienes",
  "tenes",
  "hay",
  "precio",
  "cuanto",
  "cuesta",
  "un",
  "una",
  "los",
  "las",
  "mi",
  "me",
  "por",
  "que",
]);

/**
 * El nombre de la pieza tal como la pidió el cliente: lo que queda de la consulta sin
 * relleno en los extremos, ni el vehículo, ni el año ni la cilindrada. «amortiguadores
 * delanteros» -> «amortiguadores delanteros»; «bomba de agua» se conserva con su «de».
 * `null` si no queda nada. Se usa para el encabezado cuando el grupo del ERP no sirve
 * (una abreviatura como `AMORTIG DELT`, o un grupo basura como `REPUESTO EMG`).
 */
export function piezaDeLaConsulta(
  query: string,
  vehiculo: VehiculoDeCotizacion = {},
): string | null {
  const vehiculoPlegado = new Set(
    [
      vehiculo.marca,
      vehiculo.modelo,
      vehiculo.anio ? String(vehiculo.anio) : undefined,
      vehiculo.cilindrada,
    ].flatMap((t) => palabrasPlegadas(t ?? "")),
  );
  const palabras = query
    .trim()
    .split(/\s+/)
    .filter((p) => p !== "")
    .filter((p) => !vehiculoPlegado.has(plegarTexto(p).replace(/[^0-9a-z/.*-]/g, "")));
  const util = (p: string): boolean => !AFUERA_DE_LA_PIEZA.has(plegarTexto(p));
  const desde = palabras.findIndex(util);
  if (desde === -1) return null;
  const hasta = palabras.findLastIndex(util);
  return palabras
    .slice(desde, hasta + 1)
    .join(" ")
    .toLowerCase();
}

/** Una opción de la cotización: lo que el cliente ve en cada línea. */
export interface OpcionDeCotizacion {
  marca?: string | undefined;
  procedencia?: string | undefined;
  lado?: string | undefined;
  precio: number;
}

/** «$89,55»: coma decimal, dos decimales y punto de miles. */
export function formatearPrecio(precio: number): string {
  const [entero = "0", decimales = "00"] = Math.abs(precio).toFixed(2).split(".");
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${precio < 0 ? "-" : ""}$${miles},${decimales}`;
}

/** «MARCA (Procedencia) lado $precio»; sin marca o sin procedencia, solo la que haya. */
export function lineaDeOpcion(o: OpcionDeCotizacion): string {
  const marca = o.marca?.trim() ?? "";
  const procedencia = o.procedencia?.trim() ?? "";
  const origen =
    marca !== "" && procedencia !== "" ? `${marca} (${procedencia})` : marca || procedencia;
  const lado = o.lado?.trim().toLowerCase() ?? "";
  return [origen, origen === "" ? capitalizar(lado) : lado, formatearPrecio(o.precio)]
    .filter((p) => p !== "")
    .join(" ");
}

/**
 * La cotización completa, lista para copiar: encabezado, una línea por opción (sin
 * repetir) y, si hay, la línea de piezas relacionadas.
 */
export function textoCotizacion(
  encabezado: string,
  opciones: readonly OpcionDeCotizacion[],
  relacionadasTexto: string | null | undefined,
): string {
  const lineas = [...new Set(opciones.map(lineaDeOpcion))];
  return [encabezado, ...lineas, ...(relacionadasTexto ? [relacionadasTexto] : [])].join("\n");
}
