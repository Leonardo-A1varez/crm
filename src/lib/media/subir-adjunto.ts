import { mimeDeExtension, normalizarMime, validarAdjuntoSaliente } from "@/lib/media/limites";
import type { TipoMedia } from "@/lib/media/limites";
import type { Canal } from "@/types/domain";

/**
 * El camino del navegador para mandar un archivo (docs/meta/media.md §3):
 * validar, pedir permiso de subida, subir directo a Storage y avisar al servidor.
 * Con las acciones y la subida inyectadas para probarlo sin red.
 */

/** Lo que el navegador sabe del `File` (se usa un subconjunto para poder simularlo). */
type ArchivoElegido = Pick<File, "name" | "type" | "size">;

export type ElegirAdjunto =
  | { ok: true; tipo: TipoMedia; mime: string }
  | { ok: false; mensaje: string };

/**
 * ¿Se puede mandar este archivo? Mismas reglas que el servidor
 * (`validarAdjuntoSaliente`); acá sólo evita subir lo que se va a rechazar. Si el
 * navegador no informa el tipo (`.docx`, `.ogg` en algunos sistemas) sale de la
 * extensión.
 */
export function elegirAdjunto(file: ArchivoElegido): ElegirAdjunto {
  const mime = normalizarMime(file.type) || mimeDeExtension(file.name);
  const v = validarAdjuntoSaliente({ mime, bytes: file.size, nombre: file.name });
  return v.ok ? { ok: true, tipo: v.tipo, mime: v.mime } : { ok: false, mensaje: v.mensaje };
}

type Resultado = { ok: true } | { ok: false; error: string };

export interface SubirYEnviarInput {
  leadId: string;
  sessionId: string;
  canal: Canal;
  archivo: File;
  caption: string;
  preparar: (
    input: unknown,
  ) => Promise<{ ok: true; ruta: string; token: string } | { ok: false; error: string }>;
  /** Sube directo a Storage con el token de `preparar`. */
  subir: (ruta: string, token: string, archivo: File, mime: string) => Promise<{ ok: boolean }>;
  enviar: (input: unknown) => Promise<Resultado>;
}

export async function subirYEnviarAdjunto(i: SubirYEnviarInput): Promise<Resultado> {
  const elegido = elegirAdjunto(i.archivo);
  if (!elegido.ok) return { ok: false, error: elegido.mensaje };

  const base = { leadId: i.leadId, sessionId: i.sessionId, canal: i.canal };
  const listo = await i.preparar({
    ...base,
    nombre: i.archivo.name,
    mime: elegido.mime,
    bytes: i.archivo.size,
  });
  if (!listo.ok) return { ok: false, error: listo.error };

  try {
    const subido = await i.subir(listo.ruta, listo.token, i.archivo, elegido.mime);
    if (!subido.ok) return { ok: false, error: "No se pudo subir el archivo. Reintentá." };
  } catch {
    return { ok: false, error: "No se pudo subir el archivo. Revisá tu conexión y reintentá." };
  }

  const caption = i.caption.trim();
  return i.enviar({
    ...base,
    ruta: listo.ruta,
    nombre: i.archivo.name,
    caption: caption === "" ? null : caption,
  });
}
