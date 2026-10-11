import { ValidationError } from "@/lib/errors";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
const EXT_RE = /^[a-z0-9]{1,8}$/;

/** Espeja `mensajes_media_path_check` de la migración 20261012120000. */
const RUTA_RE = new RegExp(`^sesiones/${UUID}/${UUID}\\.[a-z0-9]{1,8}$`);

/**
 * Dónde vive en el bucket `mensajes_media` el archivo de un mensaje:
 * `sesiones/<lead_session_id>/<mensaje_id>.<ext>`.
 *
 * Sólo ids y extensión: el nombre que eligió el cliente nunca forma parte de la
 * ruta (traversal, colisiones, caracteres raros). Es determinística: reintentar
 * la descarga sobrescribe el mismo objeto y no deja copias huérfanas.
 */
export function rutaDeMedia(sesionId: string, mensajeId: string, ext: string): string {
  if (!UUID_RE.test(sesionId) || !UUID_RE.test(mensajeId) || !EXT_RE.test(ext)) {
    throw new ValidationError("ruta de media inválida", "media_ruta");
  }
  return `sesiones/${sesionId}/${mensajeId}.${ext}`;
}

export function esRutaDeMedia(ruta: string): boolean {
  return RUTA_RE.test(ruta);
}
