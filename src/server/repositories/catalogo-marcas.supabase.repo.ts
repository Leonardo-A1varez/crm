import type { MarcaCatalogo } from "@/lib/catalogo/procedencia";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { CatalogoMarcasRepository } from "./catalogo-marcas.repo";

export class SupabaseCatalogoMarcasRepository implements CatalogoMarcasRepository {
  constructor(private readonly db: AppClient) {}

  async listarActivas(): Promise<MarcaCatalogo[]> {
    // Unos cientos de filas como mucho: una sola página alcanza.
    const { data, error } = await this.db
      .from("catalogo_marcas")
      .select("nombre, tipo, procedencia, activa, alias")
      .eq("activa", true)
      .limit(1000);
    if (error) throw mapPostgrestError(error, { resource: "catalogo_marcas" });
    return (data ?? []).map((r) => ({
      nombre: r.nombre,
      tipo: r.tipo,
      procedencia: r.procedencia,
      activa: r.activa,
      alias: [...(r.alias ?? [])],
    }));
  }
}
