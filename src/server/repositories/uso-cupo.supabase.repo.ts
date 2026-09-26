import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { UsoCupoRepository, UsoDeLaVentana } from "./uso-cupo.repo";

export class SupabaseUsoCupoRepository implements UsoCupoRepository {
  constructor(private readonly db: AppClient) {}

  async destinatariosPorDia(dias: number, zona: string): Promise<UsoDeLaVentana> {
    const { data, error } = await this.db.rpc("uso_cupo_whatsapp", {
      p_dias: dias,
      p_zona: zona,
    });
    if (error) throw mapPostgrestError(error, { resource: "uso_cupo_whatsapp" });
    const filas = data ?? [];
    return {
      dias: filas.map((f) => ({ dia: f.dia, destinatarios: Number(f.destinatarios) })),
      // Todas las filas traen el mismo total; sin filas no salió nada.
      totalVentana: Number(filas[0]?.total_ventana ?? 0),
    };
  }
}
