import nodePath from "node:path";

/**
 * Dónde se guarda en la PC una copia permanente de cada archivo del CRM
 * (desktop/README.md, "Archivo de media"):
 *
 *   <USERPROFILE>\CRM Genuino\Archivos\<cliente>\<YYYY-MM-DD>\<archivo>
 *
 * Directo en la carpeta del usuario —no en Documentos ni Escritorio— y NUNCA
 * dentro de OneDrive: la copia en la nube de lo que se baja acá sería una segunda
 * copia fuera del control del dueño (y de la política de retención del CRM).
 *
 * Todo con semántica de Windows (`path.win32`) en cualquier sistema: la app es de
 * Windows, y así lo que se prueba es lo que corre. Sin `electron` ni `fs`: se
 * prueba desde la raíz del repo (tests/unit/desktop).
 */
const path = nodePath.win32;

const NOMBRES_RESERVADOS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_SEGMENTO = 80;

export interface EntornoRuta {
  /** `os.homedir()`. */
  homedir: string;
  /** `process.env`. */
  env: Record<string, string | undefined>;
  /** `fs.realpathSync` que devuelve `null` si la ruta no existe. */
  realpath: (ruta: string) => string | null;
}

/**
 * Un nombre que escribió un tercero (cliente, archivo) como UN solo segmento de
 * ruta: sin separadores, `..`, caracteres de control ni los que Windows no admite,
 * sin puntos ni espacios al final, sin nombres reservados, de a lo sumo 80
 * caracteres con la extensión conservada. No lo vuelve ASCII.
 */
export function sanearSegmento(crudo: string, alternativo: string): string {
  const ultimo = crudo.normalize("NFC").split(/[\\/]/).pop() ?? "";
  let n = ultimo
    .replace(/[\t\r\n]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if (n === "") return alternativo;

  const punto = n.lastIndexOf(".");
  if (NOMBRES_RESERVADOS.test(punto > 0 ? n.slice(0, punto) : n)) n = `_${n}`;

  if (n.length > MAX_SEGMENTO) {
    const ext = punto > 0 && n.length - punto <= 11 ? n.slice(n.lastIndexOf(".")) : "";
    n = n.slice(0, MAX_SEGMENTO - ext.length) + ext;
  }
  return n;
}

const dos = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` del día del mensaje en la zona horaria de ESTA PC. */
export function carpetaDeDia(fechaIso: string): string {
  const d = new Date(fechaIso);
  if (Number.isNaN(d.getTime())) throw new Error("fecha inválida");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

export function carpetaBase(entorno: EntornoRuta): string {
  const inicio = entorno.env["USERPROFILE"]?.trim() || entorno.homedir;
  return path.join(inicio, "CRM Genuino", "Archivos");
}

export type BaseSegura = { ok: true } | { ok: false; motivo: string };

const VARIABLES_ONEDRIVE = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] as const;

function normalizar(ruta: string): string {
  return path.resolve(ruta).replace(/[\\/]+$/, "").toLowerCase();
}

/** ¿`ruta` es `contenedor` o está adentro? Compara por tramos, no por prefijo de texto. */
function estaAdentro(ruta: string, contenedor: string): boolean {
  const r = normalizar(ruta);
  const c = normalizar(contenedor);
  return r === c || r.startsWith(`${c}\\`);
}

/** La ruta real del ancestro más cercano que existe (la carpeta aún puede no existir). */
function rutaRealDelAncestro(ruta: string, realpath: EntornoRuta["realpath"]): string | null {
  let actual = path.resolve(ruta);
  for (;;) {
    const real = realpath(actual);
    if (real !== null) return real;
    const padre = path.dirname(actual);
    if (padre === actual) return null;
    actual = padre;
  }
}

/**
 * ¿Se puede guardar en `base`? No, si cae dentro de OneDrive: por las variables
 * de entorno `OneDrive`, `OneDriveConsumer` y `OneDriveCommercial`, por cualquier
 * tramo de la ruta que diga «onedrive», o porque una junction/enlace apunta a un
 * lugar así (se mira también la ruta real del ancestro que exista).
 */
export function verificarBaseSegura(base: string, entorno: EntornoRuta): BaseSegura {
  const candidatas = [base];
  const real = rutaRealDelAncestro(base, entorno.realpath);
  if (real !== null) candidatas.push(real);

  for (const ruta of candidatas) {
    const tramos = path.resolve(ruta).split(/[\\/]+/);
    if (tramos.some((t) => /onedrive/i.test(t))) {
      return { ok: false, motivo: motivo(ruta) };
    }
    for (const variable of VARIABLES_ONEDRIVE) {
      const raiz = entorno.env[variable]?.trim();
      if (raiz && estaAdentro(ruta, raiz)) return { ok: false, motivo: motivo(ruta) };
    }
  }
  return { ok: true };
}

function motivo(ruta: string): string {
  return (
    `La carpeta de archivos (${ruta}) está dentro de OneDrive. ` +
    "No se guardan archivos ahí para que no se copien a la nube. " +
    "Sacá la carpeta «CRM Genuino» de OneDrive y reiniciá la app."
  );
}

/** `<base>\<cliente>\<YYYY-MM-DD>\<archivo>`, siempre adentro de `base`. */
export function rutaDestino(
  base: string,
  cliente: string,
  fechaIso: string,
  archivo: string,
): string {
  const destino = path.join(
    base,
    sanearSegmento(cliente, "Sin nombre"),
    carpetaDeDia(fechaIso),
    sanearSegmento(archivo, "archivo"),
  );
  const rel = path.relative(base, destino);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("la ruta de destino sale de la carpeta de archivos");
  }
  return destino;
}
