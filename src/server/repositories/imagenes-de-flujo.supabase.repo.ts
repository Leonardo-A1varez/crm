import { InfraError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import type { ImagenesDeFlujoRepository, TipoImagenDeFlujo } from "./imagenes-de-flujo.repo";

const BUCKET = "mensajes_media";

/** Una hora: sobra para que Meta la descargue al mandar. */
const SEGUNDOS_DE_FIRMA = 60 * 60;

/**
 * Con el client del request para subir: la policy
 * `storage_mensajes_media_insert_flujos_admin` deja escribir sólo a un admin y
 * sólo bajo `flujos/`. Con el service-role para firmar, desde el motor.
 */
export class SupabaseImagenesDeFlujoRepository implements ImagenesDeFlujoRepository {
  constructor(private readonly db: AppClient) {}

  async subir(ruta: string, bytes: Uint8Array, tipo: TipoImagenDeFlujo): Promise<void> {
    const { error } = await this.db.storage
      .from(BUCKET)
      .upload(ruta, bytes, { contentType: tipo, upsert: false });
    if (error) throw new InfraError(`no se pudo subir la imagen: ${error.message}`, "storage");
  }

  async urlFirmada(ruta: string): Promise<string> {
    const { data, error } = await this.db.storage
      .from(BUCKET)
      .createSignedUrl(ruta, SEGUNDOS_DE_FIRMA);
    if (error || !data) {
      throw new InfraError(
        `no se pudo firmar la imagen ${ruta}: ${error?.message ?? "sin URL"}`,
        "storage",
      );
    }
    return data.signedUrl;
  }
}
