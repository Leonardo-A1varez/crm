import { InfraError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import type { MediaStorage } from "./media-storage.repo";

const BUCKET = "mensajes_media";
const PAGINA = 1000;

/**
 * Supabase Storage sobre el bucket privado `mensajes_media`.
 *
 * Con service role (descarga entrante, envío, purga) escribe y borra; con el
 * client del request firma y lee, y es la policy `storage_mensajes_media_select`
 * la que decide quién (admin y vendedor). El panel no puede escribir en
 * `sesiones/`: no hay policy de INSERT/UPDATE/DELETE para `authenticated`
 * (tests/integration/mensajes-media.supabase.test.ts).
 */
export class SupabaseMediaStorage implements MediaStorage {
  constructor(private readonly db: AppClient) {}

  async subir(path: string, bytes: Uint8Array, mime: string): Promise<void> {
    const { error } = await this.db.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (error)
      throw new InfraError(`no se pudo subir el archivo: ${error.message}`, "storage", error);
  }

  async crearSubida(path: string): Promise<{ token: string }> {
    // Sin `upsert`: la URL firmada sirve para crear ese objeto, no para pisar uno.
    const { data, error } = await this.db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      throw new InfraError(
        `no se pudo autorizar la subida: ${error?.message ?? "sin datos"}`,
        "storage",
        error,
      );
    }
    return { token: data.token };
  }

  async descargar(path: string): Promise<Uint8Array> {
    const { data, error } = await this.db.storage.from(BUCKET).download(path);
    if (error || !data) {
      if (/not found|no such|404/i.test(error?.message ?? "")) {
        throw new NotFoundError(`objeto no encontrado: ${path}`, "media", path);
      }
      throw new InfraError(
        `no se pudo leer el archivo: ${error?.message ?? "sin datos"}`,
        "storage",
        error,
      );
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async firmarUrl(
    path: string,
    segundos: number,
    opciones: { nombreDescarga?: string } = {},
  ): Promise<string> {
    const { data, error } = await this.db.storage
      .from(BUCKET)
      .createSignedUrl(
        path,
        segundos,
        opciones.nombreDescarga ? { download: opciones.nombreDescarga } : undefined,
      );
    if (error || !data) {
      // Sin la ruta en el mensaje: es un id de sesión y de mensaje, y el
      // llamador ya sabe de cuál se trata.
      throw new NotFoundError("no se pudo firmar el archivo", "media", path);
    }
    return data.signedUrl;
  }

  async borrar(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.db.storage.from(BUCKET).remove(paths);
    if (error) throw new InfraError(`no se pudo borrar: ${error.message}`, "storage", error);
  }

  /**
   * Todo lo que cuelga de una carpeta (`sesiones/<sesión>`): la purga lo usa para
   * no depender de que cada archivo tenga su fila en `mensajes` (un registro que
   * falló después de subir dejaría un objeto huérfano).
   */
  async borrarCarpeta(carpeta: string): Promise<number> {
    let borrados = 0;
    for (;;) {
      const { data, error } = await this.db.storage.from(BUCKET).list(carpeta, { limit: PAGINA });
      if (error) throw new InfraError(`no se pudo listar: ${error.message}`, "storage", error);
      const nombres = (data ?? []).filter((o) => o.id !== null).map((o) => `${carpeta}/${o.name}`);
      if (nombres.length === 0) return borrados;
      await this.borrar(nombres);
      borrados += nombres.length;
      // Si había menos que una página, ya no queda nada.
      if ((data ?? []).length < PAGINA) return borrados;
    }
  }
}
