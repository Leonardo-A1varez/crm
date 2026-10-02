import { plegarTexto } from "@/lib/catalogo/plegar-texto";
import type { BusquedaSinResultado } from "@/types/productos";

export type { BusquedaSinResultado };

export interface BusquedasSinResultadoRepository {
  /** Más repetidas primero. Solo admin en Postgres (la función lo exige). */
  listar(desde: Date, limite: number): Promise<BusquedaSinResultado[]>;
}

/** Lo mínimo de una fila de `tool_executions` que el reporte necesita. */
export interface LlamadaHerramienta {
  tool_name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
}

function textoOpcional(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = plegarTexto(v.trim());
  return t === "" ? null : t;
}

/** Espejo de la función SQL `busquedas_sin_resultado`: mismo filtro, mismo agrupado. */
export class InMemoryBusquedasSinResultadoRepository implements BusquedasSinResultadoRepository {
  constructor(private readonly llamadas: readonly LlamadaHerramienta[] = []) {}

  async listar(desde: Date, limite: number): Promise<BusquedaSinResultado[]> {
    const grupos = new Map<string, BusquedaSinResultado>();
    for (const l of this.llamadas) {
      if (l.tool_name !== "buscar_repuesto" || l.error !== null) continue;
      if (l.created_at.getTime() < desde.getTime()) continue;
      if (l.result === null || l.result["count"] !== 0) continue;
      const busqueda = textoOpcional(l.args["query"]);
      if (busqueda === null) continue;
      const marca = textoOpcional(l.args["marca"]);
      const modelo = textoOpcional(l.args["modelo"]);
      const a = l.args["anio"];
      const anio = typeof a === "number" && Number.isInteger(a) && a >= 0 && a <= 9999 ? a : null;
      const clave = JSON.stringify([busqueda, marca, modelo, anio]);
      const g = grupos.get(clave);
      if (g) {
        g.veces += 1;
        if (l.created_at > g.ultima_vez) g.ultima_vez = l.created_at;
      } else {
        grupos.set(clave, { busqueda, marca, modelo, anio, veces: 1, ultima_vez: l.created_at });
      }
    }
    return [...grupos.values()]
      .sort((x, y) => y.veces - x.veces || y.ultima_vez.getTime() - x.ultima_vez.getTime())
      .slice(0, Math.max(1, Math.min(limite, 500)));
  }
}
