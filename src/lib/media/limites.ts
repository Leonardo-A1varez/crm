import type { TipoMensaje } from "@/types/domain";

/**
 * Tipos y tamaños de archivo que WhatsApp acepta al ENVIAR, y lo que el CRM
 * guarda. Fuente: referencia de media de la Cloud API leída el 2026-10-11
 * (docs/meta/media.md §1). Lo comparten el navegador (validar antes de subir) y
 * el servidor (validar de nuevo: el navegador no es confiable).
 */

const MB = 1024 * 1024;

/**
 * Lo máximo que el CRM guarda en el bucket `mensajes_media`: el tope global de
 * Storage del proyecto (`supabase/config.toml`, 50 MiB). Meta deja enviar
 * documentos de 100 MB y recibir hasta 100 MB; esos 50 MB de diferencia no
 * caben en el bucket y se tratan como "demasiado grande".
 */
export const MAX_BYTES_ALMACENABLE = 50 * MB;

export type TipoMedia = Extract<TipoMensaje, "image" | "video" | "audio" | "doc">;

interface ReglaMime {
  mime: string;
  ext: string;
  tipo: TipoMedia;
  /** Tope de Meta para ese tipo al enviar. `null` = Meta no lo deja enviar. */
  maxMeta: number | null;
}

const IMAGEN = 5 * MB;
const AUDIO_VIDEO = 16 * MB;
const DOCUMENTO = 100 * MB;

/**
 * Todo lo que el CRM sabe nombrar. `maxMeta: null` son tipos que sólo llegan
 * (el cliente los manda) y que Meta no acepta enviar: WebP como imagen normal,
 * GIF, WAV, video WebM/MOV.
 */
const REGLAS: readonly ReglaMime[] = [
  { mime: "image/jpeg", ext: "jpg", tipo: "image", maxMeta: IMAGEN },
  { mime: "image/png", ext: "png", tipo: "image", maxMeta: IMAGEN },
  { mime: "image/webp", ext: "webp", tipo: "image", maxMeta: null },
  { mime: "image/gif", ext: "gif", tipo: "image", maxMeta: null },
  { mime: "video/mp4", ext: "mp4", tipo: "video", maxMeta: AUDIO_VIDEO },
  { mime: "video/3gpp", ext: "3gp", tipo: "video", maxMeta: AUDIO_VIDEO },
  { mime: "video/webm", ext: "webm", tipo: "video", maxMeta: null },
  { mime: "video/quicktime", ext: "mov", tipo: "video", maxMeta: null },
  { mime: "audio/aac", ext: "aac", tipo: "audio", maxMeta: AUDIO_VIDEO },
  { mime: "audio/amr", ext: "amr", tipo: "audio", maxMeta: AUDIO_VIDEO },
  { mime: "audio/mpeg", ext: "mp3", tipo: "audio", maxMeta: AUDIO_VIDEO },
  { mime: "audio/mp4", ext: "m4a", tipo: "audio", maxMeta: AUDIO_VIDEO },
  { mime: "audio/ogg", ext: "ogg", tipo: "audio", maxMeta: AUDIO_VIDEO },
  { mime: "audio/wav", ext: "wav", tipo: "audio", maxMeta: null },
  { mime: "audio/webm", ext: "weba", tipo: "audio", maxMeta: null },
  { mime: "application/pdf", ext: "pdf", tipo: "doc", maxMeta: DOCUMENTO },
  { mime: "text/plain", ext: "txt", tipo: "doc", maxMeta: DOCUMENTO },
  { mime: "application/msword", ext: "doc", tipo: "doc", maxMeta: DOCUMENTO },
  { mime: "application/vnd.ms-excel", ext: "xls", tipo: "doc", maxMeta: DOCUMENTO },
  { mime: "application/vnd.ms-powerpoint", ext: "ppt", tipo: "doc", maxMeta: DOCUMENTO },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: "docx",
    tipo: "doc",
    maxMeta: DOCUMENTO,
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
    tipo: "doc",
    maxMeta: DOCUMENTO,
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: "pptx",
    tipo: "doc",
    maxMeta: DOCUMENTO,
  },
];

const POR_MIME = new Map(REGLAS.map((r) => [r.mime, r]));
const POR_EXT = new Map(REGLAS.map((r) => [r.ext, r]));

const ENVIABLES = REGLAS.filter((r) => r.maxMeta !== null);

/** Para `<input type="file" accept>`: los tipos enviables y sus extensiones. */
export const ACCEPT_DEL_COMPOSER: string = [
  ...ENVIABLES.map((r) => r.mime),
  ...ENVIABLES.map((r) => `.${r.ext}`),
].join(",");

const FORMA_MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/** `Audio/OGG; codecs=opus` -> `audio/ogg`. Lo que no parece un tipo queda `""`. */
export function normalizarMime(crudo: string): string {
  const base = (crudo.split(";")[0] ?? "").trim().toLowerCase();
  return FORMA_MIME.test(base) ? base : "";
}

/** Para navegadores que dejan `file.type` vacío (.docx, .ogg en algunos sistemas). */
export function mimeDeExtension(nombre: string): string {
  const punto = nombre.lastIndexOf(".");
  if (punto < 0) return "";
  return POR_EXT.get(nombre.slice(punto + 1).toLowerCase())?.mime ?? "";
}

/** Extensión para la ruta de Storage. Un tipo no reconocido va como `bin`. */
export function extensionDeMime(mime: string): string {
  return POR_MIME.get(normalizarMime(mime))?.ext ?? "bin";
}

/** El tipo de mensaje (image/video/audio/doc) de un mime reconocido, o `null`. */
export function tipoDeMime(mime: string): TipoMedia | null {
  return POR_MIME.get(normalizarMime(mime))?.tipo ?? null;
}

export interface AdjuntoPorValidar {
  mime: string;
  bytes: number;
  nombre: string;
}

export type MotivoRechazoAdjunto = "vacio" | "tipo_no_permitido" | "demasiado_grande";

export type ResultadoAdjunto =
  | { ok: true; tipo: TipoMedia; mime: string; ext: string; maxBytes: number }
  | { ok: false; motivo: MotivoRechazoAdjunto; mensaje: string };

const NOMBRE_DE_TIPO: Record<TipoMedia, string> = {
  image: "La imagen",
  video: "El video",
  audio: "El audio",
  doc: "El documento",
};

function legible(bytes: number): string {
  return bytes % MB === 0 ? `${bytes / MB} MB` : `${(bytes / MB).toFixed(1)} MB`;
}

/**
 * ¿Se puede mandar este archivo por WhatsApp? Se llama en el navegador (para
 * avisar antes de subir) y en el servidor (para no creerle al navegador).
 */
export function validarAdjuntoSaliente(a: AdjuntoPorValidar): ResultadoAdjunto {
  if (!Number.isFinite(a.bytes) || a.bytes <= 0) {
    return { ok: false, motivo: "vacio", mensaje: "El archivo está vacío." };
  }
  const mime = normalizarMime(a.mime);
  const regla = POR_MIME.get(mime);
  if (!regla || regla.maxMeta === null) {
    return {
      ok: false,
      motivo: "tipo_no_permitido",
      mensaje:
        "WhatsApp no acepta ese tipo de archivo. Podés mandar JPG, PNG, MP4, 3GP, audio (AAC, AMR, MP3, M4A, OGG), PDF, Word, Excel, PowerPoint o TXT.",
    };
  }
  const maxBytes = Math.min(regla.maxMeta, MAX_BYTES_ALMACENABLE);
  if (a.bytes > maxBytes) {
    return {
      ok: false,
      motivo: "demasiado_grande",
      mensaje: `${NOMBRE_DE_TIPO[regla.tipo]} pesa ${legible(a.bytes)} y el máximo es ${legible(maxBytes)}.`,
    };
  }
  return { ok: true, tipo: regla.tipo, mime, ext: regla.ext, maxBytes };
}
