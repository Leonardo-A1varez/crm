import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type {
  BusquedaSinResultado,
  BusquedasSinResultadoRepository,
} from "./busquedas-sin-resultado.repo";

/**
 * Supabase impl: la agregación vive en la función SQL `busquedas_sin_resultado`
 * (security invoker, solo admin). Un cliente que no sea admin recibe 42501, que
 * `mapPostgrestError` traduce a PermissionDeniedError.
 */
export class SupabaseBusquedasSinResultadoRepository implements BusquedasSinResultadoRepository {
  constructor(private readonly db: AppClient) {}

  async listar(desde: Date, limite: number): Promise<BusquedaSinResultado[]> {
    const { data, error } = await this.db.rpc("busquedas_sin_resultado", {
      p_desde: desde.toISOString(),
      p_limite: limite,
    });
    if (error) throw mapPostgrestError(error, { resource: "busquedas_sin_resultado" });
    return (data ?? []).map((r) => ({
      busqueda: r.busqueda,
      marca: r.marca,
      modelo: r.modelo,
      anio: r.anio,
      veces: Number(r.veces),
      ultima_vez: new Date(r.ultima_vez),
    }));
  }
}
