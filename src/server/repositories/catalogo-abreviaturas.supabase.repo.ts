import type { Abreviatura } from "@/lib/catalogo/abreviaturas";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { CatalogoAbreviaturasRepository } from "./catalogo-abreviaturas.repo";

export class SupabaseCatalogoAbreviaturasRepository implements CatalogoAbreviaturasRepository {
  constructor(private readonly db: AppClient) {}

  async listarActivas(): Promise<Abreviatura[]> {
    // Unos cientos de filas como mucho: una sola página alcanza.
    const { data, error } = await this.db
      .from("catalogo_abreviaturas")
      .select("abrev, expansion, tipo, ambito, confianza, confirmado")
      .eq("activo", true)
      .limit(2000);
    if (error) throw mapPostgrestError(error, { resource: "catalogo_abreviaturas" });
    return (data ?? []).map((r) => ({
      abrev: r.abrev,
      expansion: r.expansion,
      tipo: r.tipo as Abreviatura["tipo"],
      ambito: r.ambito as Abreviatura["ambito"],
      confianza: r.confianza as Abreviatura["confianza"],
      confirmado: r.confirmado,
    }));
  }
}
