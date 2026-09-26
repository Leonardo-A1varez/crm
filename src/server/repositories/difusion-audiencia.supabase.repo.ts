import { IllegalStateError, ValidationError } from "@/lib/errors";
import type { AudienciaCompilada } from "@/lib/difusion/audiencia";
import type { EstadoConversacional } from "@/lib/difusion/planificador";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Database, Json } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { CurrentStage } from "@/types/domain";
import type { UUID } from "@/types/entities";
import { LIMITE_MAX_PAGINA } from "./_paginacion";
import {
  MAX_AUDIENCIA,
  type CandidatoResuelto,
  type DifusionAudienciaRepository,
} from "./difusion-audiencia.repo";

/** Ids por `.in()`: la URL de PostgREST tiene largo máximo. */
const LOTE_IDS = 200;

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

  /**
   * La misma definición que `difusion_resolver_audiencia`: la etapa de la
   * sesión con `resultado is null`, y el entrante más reciente de las
   * conversaciones de WhatsApp del lead.
   */
  async estadoConversacional(
    leadIds: readonly UUID[],
    entranteDesde: Date,
  ): Promise<Map<UUID, EstadoConversacional>> {
    const ids = [...new Set(leadIds)].filter(isUuid);
    const estados = new Map<UUID, EstadoConversacional>();
    const estadoDe = (id: UUID): EstadoConversacional => {
      let e = estados.get(id);
      if (!e) {
        e = { etapa: null, ultimoEntranteAt: null };
        estados.set(id, e);
      }
      return e;
    };

    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      const lote = ids.slice(i, i + LOTE_IDS);

      // Una sesión abierta por lead como mucho (§3 de AGENTS.md): el lote nunca
      // pasa de LOTE_IDS filas.
      const sesiones = await this.db
        .from("lead_session")
        .select("lead_id, current_stage")
        .in("lead_id", lote)
        .is("resultado", null)
        .range(0, LIMITE_MAX_PAGINA - 1);
      if (sesiones.error) throw mapPostgrestError(sesiones.error, { resource: "lead_session" });
      for (const s of sesiones.data ?? []) {
        estadoDe(s.lead_id).etapa = s.current_stage as CurrentStage;
      }

      const convs = await this.db
        .from("conversaciones")
        .select("id, lead_id")
        .in("lead_id", lote)
        .eq("canal", "wa")
        .range(0, LIMITE_MAX_PAGINA - 1);
      if (convs.error) throw mapPostgrestError(convs.error, { resource: "conversaciones" });
      const leadDeConv = new Map<string, UUID>((convs.data ?? []).map((c) => [c.id, c.lead_id]));
      if (leadDeConv.size === 0) continue;

      // Pocas filas por definición (una ventana de minutos), pero se pagina
      // hasta una página vacía: una corta no prueba que se terminó (lección 12).
      for (let desde = 0; ; desde += LIMITE_MAX_PAGINA) {
        const { data, error } = await this.db
          .from("mensajes")
          .select("conversacion_id, created_at")
          .in("conversacion_id", [...leadDeConv.keys()])
          .eq("direction", "in")
          .gte("created_at", entranteDesde.toISOString())
          .order("created_at", { ascending: false })
          .range(desde, desde + LIMITE_MAX_PAGINA - 1);
        if (error) throw mapPostgrestError(error, { resource: "mensajes" });
        const filas = data ?? [];
        if (filas.length === 0) break;
        for (const m of filas) {
          const leadId = leadDeConv.get(m.conversacion_id);
          if (leadId === undefined) continue;
          const at = new Date(m.created_at);
          const e = estadoDe(leadId);
          if (e.ultimoEntranteAt === null || at > e.ultimoEntranteAt) e.ultimoEntranteAt = at;
        }
      }
    }
    return estados;
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
