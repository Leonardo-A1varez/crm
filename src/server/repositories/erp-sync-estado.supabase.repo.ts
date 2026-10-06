import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { ErpSyncEstado } from "@/types/entities";
import type { ErpSyncEstadoRepository } from "./erp-sync-estado.repo";

const fecha = (v: string | null): Date | null => {
  if (v === null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export class SupabaseErpSyncEstadoRepository implements ErpSyncEstadoRepository {
  constructor(private readonly db: AppClient) {}

  async leer(): Promise<ErpSyncEstado | null> {
    const { data, error } = await this.db.from("erp_sync_estado").select().limit(1).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "erp_sync_estado" });
    if (data === null) return null;
    return {
      ultimo_inicio: fecha(data.ultimo_inicio),
      ultimo_fin: fecha(data.ultimo_fin),
      ultimo_exito: fecha(data.ultimo_exito),
      ultimo_error: data.ultimo_error,
      filas_cargadas: data.filas_cargadas,
      actualizado_at: fecha(data.actualizado_at),
    };
  }
}
