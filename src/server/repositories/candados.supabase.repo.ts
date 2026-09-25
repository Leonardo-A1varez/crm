import { ValidationError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";

/**
 * Los candados con vencimiento de `LeaseLock` (`server/lock/lease-lock.ts`).
 * Cumple su `AlmacenDeCandados` por forma: los repos no pueden importar de
 * `server/lock` (boundaries).
 *
 * Sólo traduce. Quién gana lo decide `tomar_candado` en un solo
 * INSERT … ON CONFLICT, así que vale entre instancias.
 */
export class SupabaseCandadosRepository {
  constructor(private readonly db: AppClient) {}

  async tomar(clave: string, duenio: string, ttlMs: number): Promise<boolean> {
    // La base lo rechaza igual, pero con un código que `mapPostgrestError`
    // clasifica como InfraError —reintentable—: un bug de config se
    // reintentaría hasta agotarse.
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new ValidationError(
        `el vencimiento de un candado tiene que ser un entero positivo de ms: ${ttlMs}`,
        "ttl_invalido",
      );
    }
    const { data, error } = await this.db.rpc("tomar_candado", {
      p_clave: clave,
      p_duenio: duenio,
      p_ttl_ms: ttlMs,
    });
    if (error) throw mapPostgrestError(error, { resource: "candados" });
    return data === true;
  }

  async soltar(clave: string, duenio: string): Promise<void> {
    const { error } = await this.db.rpc("soltar_candado", { p_clave: clave, p_duenio: duenio });
    if (error) throw mapPostgrestError(error, { resource: "candados" });
  }
}
