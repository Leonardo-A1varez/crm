import { NotFoundError } from "@/lib/errors";

/**
 * El bucket PRIVADO `mensajes_media` (migración 20261012120000), visto como
 * almacén de archivos de mensajes. Las rutas las arma `rutaDeMedia`; nada de acá
 * acepta un nombre elegido por un tercero.
 *
 * Quién usa qué: `subir` y `borrar` los usa el servidor con service role (la
 * descarga de media entrante, el envío del composer, la purga); `firmarUrl` y
 * `descargar` los puede usar un cliente con la sesión de quien mira, y es la
 * policy de SELECT del bucket la que decide.
 */
export interface MediaStorage {
  /** Crea o sobrescribe (`upsert`): reintentar una descarga no deja copias. */
  subir(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** `NotFoundError` si no existe. */
  descargar(path: string): Promise<Uint8Array>;
  /**
   * URL firmada de pocos segundos. Con `nombreDescarga`, el navegador la baja
   * como archivo con ese nombre (`Content-Disposition: attachment`) en vez de
   * abrirla.
   */
  firmarUrl(
    path: string,
    segundos: number,
    opciones?: { nombreDescarga?: string },
  ): Promise<string>;
  /** Sin error si alguna ruta no existe. */
  borrar(paths: string[]): Promise<void>;
  /** Borra todo lo que cuelga de `carpeta` (sin barra final). Devuelve cuántos. */
  borrarCarpeta(carpeta: string): Promise<number>;
}

export class InMemoryMediaStorage implements MediaStorage {
  readonly objetos = new Map<string, { bytes: Uint8Array; mime: string }>();
  /** Tests: la próxima subida falla con este error (una sola vez). */
  fallarProximaSubida: Error | null = null;

  async subir(path: string, bytes: Uint8Array, mime: string): Promise<void> {
    if (this.fallarProximaSubida) {
      const error = this.fallarProximaSubida;
      this.fallarProximaSubida = null;
      throw error;
    }
    this.objetos.set(path, { bytes: new Uint8Array(bytes), mime });
  }

  async descargar(path: string): Promise<Uint8Array> {
    const o = this.objetos.get(path);
    if (!o) throw new NotFoundError(`objeto no encontrado: ${path}`, "media", path);
    return new Uint8Array(o.bytes);
  }

  async firmarUrl(
    path: string,
    segundos: number,
    opciones: { nombreDescarga?: string } = {},
  ): Promise<string> {
    if (!this.objetos.has(path))
      throw new NotFoundError(`objeto no encontrado: ${path}`, "media", path);
    const descarga = opciones.nombreDescarga
      ? `&download=${encodeURIComponent(opciones.nombreDescarga)}`
      : "";
    return `https://storage.test/mensajes_media/${path}?token=firmada&expira=${segundos}${descarga}`;
  }

  async borrar(paths: string[]): Promise<void> {
    for (const p of paths) this.objetos.delete(p);
  }

  async borrarCarpeta(carpeta: string): Promise<number> {
    const prefijo = `${carpeta}/`;
    const rutas = [...this.objetos.keys()].filter((p) => p.startsWith(prefijo));
    for (const p of rutas) this.objetos.delete(p);
    return rutas.length;
  }
}
