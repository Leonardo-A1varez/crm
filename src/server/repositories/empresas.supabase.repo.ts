import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { unicaOFalla, type Empresa, type EmpresasRepository } from "./empresas.repo";

interface FilaEmpresa {
  id: string;
  nombre: string;
  ruc_nit: string | null;
  created_at: string;
}

function mapFila(row: FilaEmpresa): Empresa {
  return {
    id: row.id,
    nombre: row.nombre,
    ruc_nit: row.ruc_nit,
    created_at: new Date(row.created_at),
  };
}

/**
 * Lectura de `empresas` con el client del request: la policy `empresas_select`
 * deja leer a admin y vendedor.
 */
export class SupabaseEmpresasRepository implements EmpresasRepository {
  constructor(private readonly db: AppClient) {}

  async obtenerUnica(): Promise<Empresa | null> {
    const { data, error } = await this.db
      .from("empresas")
      .select("id, nombre, ruc_nit, created_at")
      .order("created_at", { ascending: true })
      // Dos filas alcanzan para saber si hay más de una. Rango explícito
      // además porque PostgREST corta sin avisar (lección 12 de AGENTS.md).
      .range(0, 1);

    if (error) throw mapPostgrestError(error, { resource: "empresa" });
    return unicaOFalla((data ?? []).map(mapFila));
  }
}
