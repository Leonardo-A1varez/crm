import type { ModeloCatalogo } from "@/lib/catalogo/compatibilidad";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { CatalogoModelosRepository } from "./catalogo-modelos.repo";

const CONFIANZAS = new Set<string>(["alta", "media", "baja"]);

export class SupabaseCatalogoModelosRepository implements CatalogoModelosRepository {
  constructor(private readonly db: AppClient) {}

  async listarActivos(): Promise<ModeloCatalogo[]> {
    // Unas pocas centenas de filas (el CSV trae 395): una sola página alcanza.
    const { data, error } = await this.db
      .from("catalogo_modelos")
      .select("marca, sigla_modelo, nombre_real, alias, confianza, confirmado")
      .eq("activo", true)
      .limit(1000);
    if (error) throw mapPostgrestError(error, { resource: "catalogo_modelos" });
    return (data ?? []).map((r) => ({
      marca: r.marca,
      sigla_modelo: r.sigla_modelo,
      nombre_real: r.nombre_real,
      alias: [...(r.alias ?? [])],
      confianza: CONFIANZAS.has(r.confianza)
        ? (r.confianza as ModeloCatalogo["confianza"])
        : "baja",
      confirmado: r.confirmado,
    }));
  }
}
