import { IllegalStateError, ValidationError } from "@/lib/errors";
import type { AudienciaCompilada } from "@/lib/difusion/audiencia";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Database, Json } from "@/server/db/types.gen";
import type { CurrentStage } from "@/types/domain";
import { LIMITE_MAX_PAGINA } from "./_paginacion";
import {
  MAX_AUDIENCIA,
  type CandidatoResuelto,
  type DifusionAudienciaRepository,
} from "./difusion-audiencia.repo";

type FilaResuelta =
  Database["public"]["Functions"]["difusion_resolver_audiencia"]["Returns"][number];

/**
 * Supabase impl de `DifusionAudienciaRepository`.
 *
 * Pagina por keyset: cada llamada pide hasta 1.000 leads después del último id
 * recibido. Se detiene recién con una página **vacía**, no con una corta: si
 * el servidor recortara más abajo de lo pedido (`max_rows`), una página corta
 * no significaría que se terminó, y cortar ahí sería el bug de la lección 12
 * de AGENTS.md —la audiencia se achica sin un error en ningún log—.
 */
export class SupabaseDifusionAudienciaRepository implements DifusionAudienciaRepository {
  private readonly maxAudiencia: number;

  constructor(
    private readonly db: AppClient,
    opciones: { maxAudiencia?: number } = {},
  ) {
    this.maxAudiencia = opciones.maxAudiencia ?? MAX_AUDIENCIA;
  }

  async resolver(audiencia: AudienciaCompilada, ahora: Date): Promise<CandidatoResuelto[]> {
    const todos: CandidatoResuelto[] = [];
    let despuesDe: string | undefined;

    for (;;) {
      const { data, error } = await this.db.rpc("difusion_resolver_audiencia", {
        p_audiencia: audiencia as unknown as Json,
        p_ahora: ahora.toISOString(),
        ...(despuesDe === undefined ? {} : { p_despues_de: despuesDe }),
        p_limite: LIMITE_MAX_PAGINA,
      });
      if (error) throw mapPostgrestError(error, { resource: "difusion_audiencia" });

      const filas = data ?? [];
      const ultima = filas.at(-1);
      if (ultima === undefined) return todos;

      for (const f of filas) todos.push(mapFila(f));
      if (todos.length > this.maxAudiencia) {
        throw new ValidationError(
          `La audiencia pasa de ${this.maxAudiencia.toLocaleString("es")} leads. Acotala con más condiciones: una difusión así de grande no se planifica de una sola vez.`,
        );
      }
      // Un cursor que no avanza pediría la misma página para siempre.
      if (ultima.lead_id === despuesDe) {
        throw new IllegalStateError(
          "el resolver de audiencia devolvió la misma página dos veces",
          "keyset_sin_avance",
        );
      }
      despuesDe = ultima.lead_id;
    }
  }

  async usoCupoDesde(desde: Date): Promise<number> {
    const { data, error } = await this.db.rpc("difusion_uso_cupo_24h", {
      p_desde: desde.toISOString(),
    });
    if (error) throw mapPostgrestError(error, { resource: "difusion_audiencia" });
    return data ?? 0;
  }
}

function mapFila(f: FilaResuelta): CandidatoResuelto {
  // El generador tipa las columnas de RETURNS TABLE como no nulas; estas tres
  // vienen null cuando el lead no tiene sesión activa, entrante o vehículo.
  const etapa = f.etapa_activa as CurrentStage | null;
  const entrante = f.ultimo_entrante_at as string | null;
  const vehiculo = f.vehiculo as string | null;
  return {
    leadId: f.lead_id,
    nombre: f.nombre,
    telefono: f.telefono,
    etapaActiva: etapa,
    ultimoEntranteAt: entrante === null ? null : new Date(entrante),
    salientesAutomaticos24h: f.salientes_automaticos_24h,
    vehiculo,
  };
}
