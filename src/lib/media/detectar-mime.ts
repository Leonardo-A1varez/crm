import { normalizarMime, tipoDeMime } from "@/lib/media/limites";

/**
 * Reconocimiento del tipo real de un archivo por sus primeros bytes.
 *
 * Para qué: el tipo que declara el que sube (el navegador del vendedor o Meta
 * por el cliente) es un dato de un tercero. Lo que se guarda como imagen, audio
 * o video se muestra en línea en el panel, así que un HTML o un ejecutable
 * disfrazado de `image/png` no puede pasar por tal. Y al enviar, Meta rechaza
 * con el error 131053 un archivo cuyo tipo no coincide con su contenido.
 *
 * No es un antivirus ni intenta serlo: sólo cierra la brecha "el nombre dice una
 * cosa y los bytes otra". Firmas de formato publicadas (RFC 2083 PNG, ISO 14496
 * `ftyp`, etc.).
 */

const SIN_TIPO = "application/octet-stream";

/** La firma ASCII `texto` a partir de `desde`. */
function es(bytes: Uint8Array, desde: number, texto: string): boolean {
  if (bytes.length < desde + texto.length) return false;
  for (let i = 0; i < texto.length; i++) {
    if (bytes[desde + i] !== texto.charCodeAt(i)) return false;
  }
  return true;
}

function empiezaCon(bytes: Uint8Array, firma: readonly number[]): boolean {
  return bytes.length >= firma.length && firma.every((v, i) => bytes[i] === v);
}

function pareceTexto(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  if (n === 0) return false;
  for (let i = 0; i < n; i++) {
    const c = bytes[i]!;
    // Un byte nulo no aparece en texto; el resto de los de control, salvo
    // tab, salto de línea y retorno, tampoco.
    if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) return false;
  }
  return true;
}

/** Tipo canónico según las firmas, o `null` si no se reconoce ninguna. */
export function detectarMime(bytes: Uint8Array): string | null {
  if (bytes.length < 2) return null;

  if (empiezaCon(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (empiezaCon(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (es(bytes, 0, "GIF87a") || es(bytes, 0, "GIF89a")) return "image/gif";
  if (es(bytes, 0, "RIFF") && es(bytes, 8, "WEBP")) return "image/webp";
  if (es(bytes, 0, "RIFF") && es(bytes, 8, "WAVE")) return "audio/wav";
  if (es(bytes, 0, "%PDF-")) return "application/pdf";
  if (es(bytes, 0, "OggS")) return "audio/ogg";
  if (es(bytes, 0, "#!AMR")) return "audio/amr";
  if (empiezaCon(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (empiezaCon(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "application/x-ole-storage";
  }
  if (es(bytes, 0, "PK") && bytes[2] === 3 && bytes[3] === 4) return "application/zip";

  if (es(bytes, 4, "ftyp")) {
    if (es(bytes, 8, "3gp") || es(bytes, 8, "3g2")) return "video/3gpp";
    if (es(bytes, 8, "M4A ")) return "audio/mp4";
    if (es(bytes, 8, "qt  ")) return "video/quicktime";
    return "video/mp4";
  }

  if (es(bytes, 0, "ID3")) return "audio/mpeg";
  // Cabecera de trama MPEG/ADTS: 11 bits en 1. Si los bits de capa son 00 es
  // AAC (ADTS); si no, MP3.
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) {
    return (bytes[1]! & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
  }

  return pareceTexto(bytes) ? "text/plain" : null;
}

const FAMILIA_MP4 = new Set(["video/mp4", "audio/mp4"]);
const FAMILIA_ZIP = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const FAMILIA_OLE = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

function coincide(declarado: string, detectado: string | null): boolean {
  if (detectado === null) return false;
  if (declarado === detectado) return true;
  // Un MP4 con sólo audio se declara `audio/mp4`, y el contenedor es el mismo.
  if (FAMILIA_MP4.has(declarado) && FAMILIA_MP4.has(detectado)) return true;
  if (FAMILIA_ZIP.has(declarado) && detectado === "application/zip") return true;
  if (FAMILIA_OLE.has(declarado) && detectado === "application/x-ole-storage") return true;
  // WebM puede ser sólo audio.
  if (declarado === "audio/webm" && detectado === "video/webm") return true;
  return false;
}

export type VerificacionContenido =
  | { ok: true; mime: string }
  | { ok: false; detectado: string | null };

/** ¿Los bytes son del tipo que se declaró? `mime` vuelve normalizado. */
export function verificarContenido(declarado: string, bytes: Uint8Array): VerificacionContenido {
  const mime = normalizarMime(declarado);
  const detectado = detectarMime(bytes);
  return coincide(mime, detectado) ? { ok: true, mime } : { ok: false, detectado };
}

export interface MimeEntrante {
  /** Lo que se guarda en `media_mime` y como `contentType` del objeto. */
  mime: string;
  /** `true` sólo para imagen, audio y video verificados: lo único que el hilo reproduce. */
  enLinea: boolean;
}

/**
 * Qué se guarda de un archivo que llegó de un cliente. Lo verificado y
 * reconocido va con su tipo; lo demás (tipo ajeno a WhatsApp, contenido que no
 * es lo que dice) va como `application/octet-stream` y nunca se muestra en
 * línea: se ofrece para descargar.
 */
export function resolverMimeEntrante(declarado: string, bytes: Uint8Array): MimeEntrante {
  const detectado = detectarMime(bytes);
  const dicho = normalizarMime(declarado);

  let mime: string | null = null;
  if (dicho === "") {
    mime = detectado !== null && tipoDeMime(detectado) !== null ? detectado : null;
  } else if (tipoDeMime(dicho) !== null && coincide(dicho, detectado)) {
    mime = dicho;
  }
  if (mime === null) return { mime: SIN_TIPO, enLinea: false };

  const tipo = tipoDeMime(mime);
  return { mime, enLinea: tipo === "image" || tipo === "audio" || tipo === "video" };
}
