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
  return { plural, femenino: raiz.endsWith("a") && !MASCULINAS_EN_A.has(raiz) };
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
  const palabras = palabrasPlegadas(categoria);
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
  // Una categoría de una sola palabra viene en plural del ERP («TERMOSTATOS»): se nombra la pieza.
  const entera = palabras.length === 1 ? palabras.map(singular) : palabras;
  const nombre = sobrantes.length > 0 ? sobrantes.join(" ") : entera.join(" ");
  const g = generoDe(sobrantes[0] ?? entera.find((p) => !FILLER.has(p)) ?? nombre);
  return `${articulo(g)} ${nombre}`;
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

  const partes = [
    capitalizar(pieza),
    vehiculo.modelo?.trim() || vehiculo.marca?.trim() || "",
    vehiculo.anio !== undefined && vehiculo.anio > 0 ? String(vehiculo.anio) : "",
    vehiculo.cilindrada?.trim() ?? "",
  ].filter((p) => p !== "");
  return `${partes.join(" ")} (IVA incluido):`;
}
