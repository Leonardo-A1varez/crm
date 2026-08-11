import { cotasActividad } from "@/lib/actividad";
import { recorteConCoincidencia } from "@/lib/ui/busqueda-hilo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type {
  CoincidenciaContenido,
  MessagesRepository,
} from "@/server/repositories/messages.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { Lead, LeadSession, UUID } from "@/types/entities";
import type { BusquedaPage, FragmentoCoincidencia, ResultadoBusqueda } from "@/types/inbox";
import type { BusquedaInput, BusquedaService } from "./busqueda.service";

/**
 * Mínimo para buscar algo. Con una letra el resultado son todas las
 * conversaciones y el buscador no dice nada.
 */
export const MIN_CARACTERES = 2;

/**
 * Mínimo para entrar a `mensajes`.
 *
 * Es el umbral del índice trigram, no una preferencia: `gin_trgm_ops` necesita
 * 3 caracteres para extraer un trigrama del patrón, y con menos el planner
 * vuelve al scan secuencial de la tabla más grande del sistema. Con 1 o 2
 * caracteres la búsqueda sigue andando sobre las columnas del lead —que son
 * pocas filas y tienen su propio índice— y `soloDatosDelLead` lo avisa en
 * pantalla en vez de mentir con "sin resultados".
 */
export const MIN_CARACTERES_CONTENIDO = 3;

/** El texto de búsqueda es un término, no un campo de datos. */
const Q_MAX = 80;

/**
 * Tope de mensajes que se traen de la búsqueda de contenido.
 *
 * No es el tope de resultados: son las filas crudas de `mensajes` que después
 * se agrupan por conversación. Se pide de más a propósito —200 mensajes pueden
 * ser 200 conversaciones distintas o una sola— y de ahí salen como mucho
 * `LIMITE_RESULTADOS` filas.
 */
const LIMITE_MENSAJES = 200;

/** Tope de leads que se traen de la consulta de leads. Mismo criterio. */
const LIMITE_LEADS = 300;

/** Conversaciones que se muestran. Lo que queda afuera se avisa. */
export const LIMITE_RESULTADOS = 30;

export interface DefaultBusquedaServiceDeps {
  leads: LeadsRepository;
  sessions: LeadSessionRepository;
  messages: MessagesRepository;
  /** Solo para el filtro por etiqueta: una consulta al pivot, nunca una por lead. */
  tags: TagsRepository;
}

function vacia(soloDatosDelLead: boolean): BusquedaPage {
  return { resultados: [], truncado: false, limite: LIMITE_RESULTADOS, soloDatosDelLead };
}

/** Ids únicos conservando el orden de aparición. */
function unicos(ids: readonly UUID[]): UUID[] {
  return Array.from(new Set(ids));
}

export class DefaultBusquedaService implements BusquedaService {
  constructor(private readonly deps: DefaultBusquedaServiceDeps) {}

  async buscar(input: BusquedaInput): Promise<BusquedaPage> {
    const q = input.q.trim().slice(0, Q_MAX);
    const buscaContenido = q.length >= MIN_CARACTERES_CONTENIDO;
    const soloDatosDelLead = !buscaContenido;
    if (q.length < MIN_CARACTERES) return vacia(soloDatosDelLead);

    // ---- Consulta 1: los mensajes cuyo texto coincide. --------------------
    const coincidencias = buscaContenido
      ? await this.deps.messages.buscarContenido(q, { limit: LIMITE_MENSAJES })
      : [];

    // ---- Consulta 2: a qué lead pertenece cada sesión con coincidencia. ---
    // De una sola vez. La alternativa —resolver el lead de cada mensaje— sería
    // un N+1 sobre la lista que justamente puede tener cientos de filas.
    const sesionesConMatch = await this.deps.sessions.listByIds(
      unicos(coincidencias.map((c) => c.leadSessionId)),
    );
    const leadPorSesion = new Map<UUID, UUID>(sesionesConMatch.map((s) => [s.id, s.lead_id]));

    // ---- Consulta 3: los leads, y 4: las sesiones abiertas. ---------------
    // Los leads que solo matchearon por contenido entran a la MISMA consulta
    // como `idsExtra` (rama `id.in.(…)` del OR), que es el patrón que ya usa la
    // pantalla de leads para el código cotizado. Así el canal y la ventana de
    // actividad se aplican en SQL sobre todo el conjunto, no a mano sobre una
    // mitad.
    const [rows, activas] = await Promise.all([
      this.deps.leads.list({
        q,
        idsExtra: unicos(Array.from(leadPorSesion.values())),
        canal: input.canal,
        ...cotasActividad(input.actividad, input.ahora ?? new Date()),
        limit: LIMITE_LEADS,
      }),
      this.deps.sessions.listActive(),
    ]);

    const sesionPorLead = new Map<UUID, LeadSession>(activas.map((s) => [s.lead_id, s]));

    // ---- Consulta 5 (solo con filtro de etiqueta). ------------------------
    const conEtiqueta =
      input.etiquetaId === undefined
        ? null
        : new Set(await this.deps.tags.listLeadIdsByTag(input.etiquetaId));

    const filtrados = rows.filter((lead) => {
      const sesion = sesionPorLead.get(lead.id);
      if (input.sesion === "activa" && sesion === undefined) return false;
      if (input.sesion === "cerrada" && sesion !== undefined) return false;
      // Sin sesión abierta no hay etapa vigente: la de la última sesión cerrada
      // quedó congelada donde terminó y filtrar por ella mentiría sobre el
      // estado del lead. Mismo criterio que `LeadListItem.currentStage`.
      if (input.etapa !== undefined && sesion?.current_stage !== input.etapa) return false;
      if (conEtiqueta !== null && !conEtiqueta.has(lead.id)) return false;
      return true;
    });

    const porLead = this.agruparCoincidencias(coincidencias, leadPorSesion);
    const resultados = filtrados
      .slice(0, LIMITE_RESULTADOS)
      .map((lead) => this.aResultado(lead, sesionPorLead.get(lead.id), porLead.get(lead.id), q));

    return {
      resultados,
      // Tres formas de dejar algo afuera y las tres se avisan igual: el tope de
      // mensajes, el de leads y el de filas mostradas.
      truncado:
        coincidencias.length >= LIMITE_MENSAJES ||
        rows.length >= LIMITE_LEADS ||
        filtrados.length > LIMITE_RESULTADOS,
      limite: LIMITE_RESULTADOS,
      soloDatosDelLead,
    };
  }

  /**
   * Las coincidencias agrupadas por lead. `buscarContenido` las devuelve de la
   * más reciente a la más vieja, así que la primera de cada lead es la que se
   * muestra.
   */
  private agruparCoincidencias(
    coincidencias: readonly CoincidenciaContenido[],
    leadPorSesion: ReadonlyMap<UUID, UUID>,
  ): Map<UUID, { primera: CoincidenciaContenido; total: number }> {
    const out = new Map<UUID, { primera: CoincidenciaContenido; total: number }>();
    for (const c of coincidencias) {
      const leadId = leadPorSesion.get(c.leadSessionId);
      // Sesión que ya no está: la purga corre entre las dos consultas.
      if (leadId === undefined) continue;
      const previo = out.get(leadId);
      if (previo) previo.total += 1;
      else out.set(leadId, { primera: c, total: 1 });
    }
    return out;
  }

  private aResultado(
    lead: Lead,
    sesion: LeadSession | undefined,
    match: { primera: CoincidenciaContenido; total: number } | undefined,
    q: string,
  ): ResultadoBusqueda {
    let fragmento: FragmentoCoincidencia | null = null;
    if (match) {
      // El recorte se hace acá y no en el cliente: un mensaje de WhatsApp puede
      // tener 4096 caracteres y la fila muestra una línea. Cortar en el cliente
      // dejaría afuera justo la palabra buscada.
      const recorte = recorteConCoincidencia(match.primera.contenido, q);
      fragmento = {
        mensajeId: match.primera.mensajeId,
        texto: recorte.texto,
        recortadoInicio: recorte.recortadoInicio,
        recortadoFin: recorte.recortadoFin,
        direction: match.primera.direction,
        createdAt: match.primera.createdAt,
      };
    }

    return {
      leadId: lead.id,
      nombre: lead.nombre,
      telefono: lead.telefono,
      canalOrigen: lead.canal_origen,
      currentStage: sesion?.current_stage ?? null,
      sesionActiva: sesion !== undefined,
      ultimaActividad: lead.updated_at,
      fragmento,
      mensajesCoincidentes: match?.total ?? 0,
    };
  }
}
