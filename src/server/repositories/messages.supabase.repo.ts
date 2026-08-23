import { ConflictError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { escaparLike } from "@/server/db/postgrest-like";
import { isUuid } from "@/server/db/uuid";
import { esAvance } from "@/lib/entrega";
import type { Direction, EstadoEntrega, Sender, TipoMensaje } from "@/types/domain";
import type { Mensaje, MensajeMetadata, UUID } from "@/types/entities";
import type {
  BuscarContenidoFilter,
  CoincidenciaContenido,
  EstadoEntregaPatch,
  ListByConversacionFilter,
  ListBySessionFilter,
  InboxRecentMessage,
  MensajeInsert,
  MessagesRepository,
} from "./messages.repo";

const DEFAULT_LIMIT = 50;

// 100 uuids son ~3,7 KB de query string: entra holgado en cualquier proxy y
// deja una sola tanda para un piloto entero (30 vendedores).
const SESSION_IDS_POR_TANDA = 100;

/**
 * Supabase impl MessagesRepository. Slice 1 sub-paso 7.4 repo 8.
 *
 * FKs NOT NULL:
 *   - conversacion_id → conversaciones.id ON DELETE CASCADE
 *   - lead_session_id → lead_session.id ON DELETE CASCADE
 *   - sender_user_id  → usuarios.id ON DELETE SET NULL (nullable)
 *
 * UNIQUE partial:
 *   - uq_mensajes_meta_message_id: (meta_message_id) WHERE meta_message_id IS NOT NULL
 *   - uq_mensajes_outbound_idempotency: (idempotency_key) WHERE direction='out' AND idempotency_key IS NOT NULL
 *
 * Disambiguation 23505 por constraint name en error.message → ConflictError
 * con conflictType específico (matchea contract test parity InMemory).
 */
export class SupabaseMessagesRepository implements MessagesRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: MensajeInsert): Promise<Mensaje> {
    const { data, error } = await this.db
      .from("mensajes")
      .insert({
        conversacion_id: input.conversacion_id,
        lead_session_id: input.lead_session_id,
        direction: input.direction,
        sender: input.sender,
        sender_user_id: input.sender_user_id,
        tipo: input.tipo,
        contenido: input.contenido,
        media_url: input.media_url,
        meta_message_id: input.meta_message_id,
        idempotency_key: input.idempotency_key,
        metadata: input.metadata as never,
        platform_created_at: isoDePlataforma(input.platform_created_at),
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        const msg = error.message ?? "";
        if (msg.includes("uq_mensajes_meta_message_id")) {
          throw new ConflictError(
            `meta_message_id duplicado: ${input.meta_message_id}`,
            "duplicate_meta_message_id",
            error,
          );
        }
        if (msg.includes("uq_mensajes_outbound_idempotency")) {
          throw new ConflictError(
            `idempotency_key duplicado: ${input.idempotency_key}`,
            "duplicate_idempotency_key",
            error,
          );
        }
        // Fallback genérico — debug si aparece.
        throw new ConflictError(msg, "unique_violation", error);
      }
      throw mapPostgrestError(error, { resource: "mensaje" });
    }
    return mapRow(data);
  }

  async findById(id: UUID): Promise<Mensaje | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("mensajes").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "mensaje" });
    return data ? mapRow(data) : null;
  }

  async findByMetaMessageId(metaMessageId: string): Promise<Mensaje | null> {
    // PostgREST `.eq("col", "")` no matchea NULL — semantics correctos vs contract.
    const { data, error } = await this.db
      .from("mensajes")
      .select()
      .eq("meta_message_id", metaMessageId)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "mensaje" });
    return data ? mapRow(data) : null;
  }

  async findByIdempotencyKey(key: string): Promise<Mensaje | null> {
    const { data, error } = await this.db
      .from("mensajes")
      .select()
      .eq("direction", "out")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "mensaje" });
    return data ? mapRow(data) : null;
  }

  async listByConversacion(
    conversacionId: UUID,
    filter: ListByConversacionFilter = {},
  ): Promise<Mensaje[]> {
    if (!isUuid(conversacionId)) return [];
    const limit = filter.limit ?? DEFAULT_LIMIT;
    let query = this.db
      .from("mensajes")
      .select()
      .eq("conversacion_id", conversacionId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (filter.before) {
      query = query.lt("created_at", filter.before.toISOString());
    }
    const { data, error } = await query;
    if (error) throw mapPostgrestError(error, { resource: "mensaje" });
    return (data ?? []).map(mapRow);
  }

  async listBySessionId(sessionId: UUID, filter: ListBySessionFilter = {}): Promise<Mensaje[]> {
    if (!isUuid(sessionId)) return [];
    const limit = filter.limit ?? DEFAULT_LIMIT;
    // DESC + limit trae los N más recientes; reverse → ASC para el thread.
    const { data, error } = await this.db
      .from("mensajes")
      .select()
      .eq("lead_session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw mapPostgrestError(error, { resource: "mensaje" });
    return (data ?? []).map(mapRow).reverse();
  }

  async listBySessionIds(sessionIds: UUID[]): Promise<Mensaje[]> {
    const ids = sessionIds.filter(isUuid);
    if (ids.length === 0) return [];

    // Se parte en tandas porque `.in()` viaja en la query string: con todas las
    // sesiones activas de una instancia grande, un solo GET se pasaría del
    // largo de URL que acepta el proxy y fallaría con 414, no con un error de
    // dominio. Cada tanda es una consulta, nunca una por sesión.
    const out: Mensaje[] = [];
    for (let i = 0; i < ids.length; i += SESSION_IDS_POR_TANDA) {
      const tanda = ids.slice(i, i + SESSION_IDS_POR_TANDA);
      const { data, error } = await this.db
        .from("mensajes")
        .select()
        .in("lead_session_id", tanda)
        .order("created_at", { ascending: true });
      if (error) throw mapPostgrestError(error, { resource: "mensaje" });
      for (const row of data ?? []) out.push(mapRow(row));
    }
    return out.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }

  async listRecentBySessionIds(sessionIds: UUID[], limit: number): Promise<InboxRecentMessage[]> {
    const ids = sessionIds.filter(isUuid);
    if (ids.length === 0 || limit <= 0) return [];

    // La función SQL aplica LIMIT dentro de cada sesión. Un `.in()` con LIMIT
    // limitaría el conjunto global y dejaría algunas sesiones sin mensajes.
    const { data, error } = await this.db.rpc("inbox_recent_messages", {
      p_session_ids: ids,
      p_limit: Math.min(limit, 200),
    });
    if (error) throw mapPostgrestError(error, { resource: "inbox_recent_messages" });
    return (data ?? []).map((row) => ({
      ...row,
      created_at: new Date(row.created_at),
    }));
  }

  async buscarContenido(
    q: string,
    filter: BuscarContenidoFilter,
  ): Promise<CoincidenciaContenido[]> {
    if (q === "") return [];

    // `.ilike()` y no `.or(...)`: el valor viaja como parámetro y no atraviesa
    // el árbol de filtros de PostgREST, así que alcanza con escapar los
    // comodines de LIKE. Sin `escaparLike`, un mensaje buscado con guion bajo
    // —"FRE_1234"— matchearía cualquier caracter en esa posición.
    //
    // Solo se piden las 5 columnas que el buscador dibuja. `select("*")` traería
    // `metadata` (jsonb del webhook de Meta) de cada fila candidata para
    // tirarlo.
    const { data, error } = await this.db
      .from("mensajes")
      .select("id, lead_session_id, contenido, direction, created_at")
      .ilike("contenido", `%${escaparLike(q)}%`)
      .order("created_at", { ascending: false })
      .limit(filter.limit);

    if (error) throw mapPostgrestError(error, { resource: "mensaje" });

    const out: CoincidenciaContenido[] = [];
    for (const row of data ?? []) {
      // El filtro garantiza que no es null, pero el tipo generado no lo sabe:
      // se descarta en vez de castear (mismo criterio que `listCierres`).
      if (row.contenido === null) continue;
      out.push({
        mensajeId: row.id,
        leadSessionId: row.lead_session_id,
        contenido: row.contenido,
        direction: row.direction,
        createdAt: new Date(row.created_at),
      });
    }
    return out;
  }

  /**
   * `lead_id` no vive en `mensajes` sino en la conversación que lo contiene
   * -- mismo motivo que `listMensajesDesde` en `metrics.supabase.repo.ts` --
   * así que se filtra sobre el embed `conversaciones!inner(lead_id)`. El
   * `!inner` no es cosmético: sin él, PostgREST no admite filtrar por una
   * columna del recurso embebido.
   *
   * `head: true` descarta el body: a este conteo no le importa una sola fila,
   * y traer 3-20 mensajes por lead en cada envío sería puro desperdicio en el
   * camino más caliente de esta acción.
   */
  async contarSalientesAutomaticos(leadId: UUID, desde: Date): Promise<number> {
    const { count, error } = await this.db
      .from("mensajes")
      .select("id, conversaciones!inner(lead_id)", { count: "exact", head: true })
      .eq("conversaciones.lead_id", leadId)
      .eq("direction", "out")
      .in("sender", ["ia", "sistema"])
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "mensajes" });
    return count ?? 0;
  }

  /** Ver el doc comment de la interface (`messages.repo.ts`) para el por qué. */
  async findUltimoEntranteAt(conversacionId: UUID): Promise<Date | null> {
    const { data, error } = await this.db
      .from("mensajes")
      .select("created_at")
      .eq("conversacion_id", conversacionId)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "mensajes" });
    return data ? new Date(data.created_at) : null;
  }

  async confirmarEnvio(id: UUID, metaMessageId: string): Promise<Mensaje> {
    const { data, error } = await this.db
      .from("mensajes")
      .update({ meta_message_id: metaMessageId })
      .eq("id", id)
      .select()
      .single();
    if (error) throw mapPostgrestError(error, { resource: "mensajes" });
    return mapRow(data as MensajeRow);
  }

  async marcarFalloEnvio(id: UUID, error: string): Promise<Mensaje> {
    const { data, error: dbError } = await this.db
      .from("mensajes")
      .update({
        estado_entrega: "fallido",
        estado_entrega_at: new Date().toISOString(),
        error_entrega: error,
      })
      .eq("id", id)
      .select()
      .single();
    if (dbError) throw mapPostgrestError(dbError, { resource: "mensajes" });
    return mapRow(data as MensajeRow);
  }

  async liberarReserva(id: UUID): Promise<void> {
    const actual = await this.findById(id);
    if (!actual) return;
    if (actual.meta_message_id !== null) {
      throw new ConflictError(
        `mensaje ya confirmado por Meta, no se libera: ${id}`,
        "reserva_confirmada",
      );
    }
    // El filtro `is null` sobre meta_message_id repite la guarda en SQL: entre
    // el findById y este delete pudo entrar la confirmación del envío.
    const { error } = await this.db
      .from("mensajes")
      .delete()
      .eq("id", id)
      .is("meta_message_id", null);
    if (error) throw mapPostgrestError(error, { resource: "mensajes" });
  }

  async aplicarEstadoEntrega(
    metaMessageId: string,
    patch: EstadoEntregaPatch,
  ): Promise<Mensaje | null> {
    const actual = await this.findByMetaMessageId(metaMessageId);
    if (!actual) return null;
    if (!esAvance(actual.estado_entrega, patch.estado)) return actual;

    const { data, error } = await this.db
      .from("mensajes")
      .update({
        estado_entrega: patch.estado,
        estado_entrega_at: patch.at.toISOString(),
        error_entrega: patch.error,
      })
      .eq("id", actual.id)
      .select()
      .single();
    if (error) throw mapPostgrestError(error, { resource: "mensajes" });
    return mapRow(data as MensajeRow);
  }
}

interface MensajeRow {
  id: string;
  conversacion_id: string;
  lead_session_id: string;
  direction: Direction;
  sender: Sender;
  sender_user_id: string | null;
  tipo: TipoMensaje;
  contenido: string | null;
  media_url: string | null;
  meta_message_id: string | null;
  idempotency_key: string | null;
  metadata: unknown;
  created_at: string;
  platform_created_at: string | null;
  estado_entrega: EstadoEntrega | null;
  estado_entrega_at: string | null;
  error_entrega: string | null;
}

/**
 * El reloj de Meta, como ISO para Postgres.
 *
 * Acepta `Date` o string aunque el tipo diga `Date`: el valor cruza la frontera
 * JSON de Inngest y del otro lado llega serializado. Un `.toISOString()` a secas
 * compilaba y explotaba en runtime —fue lo que impidió persistir el primer
 * WhatsApp real—. La revivificación vive en el handler; esto es la segunda
 * barrera, en la capa que efectivamente escribe.
 *
 * Una fecha inválida vuelve `null`: es un dato opcional, y `null` dice "no se
 * sabe" mientras que un `Invalid Date` rompe el insert entero.
 */
function isoDePlataforma(valor: Date | string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function mapRow(row: MensajeRow): Mensaje {
  const meta = (row.metadata ?? {}) as MensajeMetadata;
  return {
    id: row.id,
    conversacion_id: row.conversacion_id,
    lead_session_id: row.lead_session_id,
    direction: row.direction,
    sender: row.sender,
    sender_user_id: row.sender_user_id,
    tipo: row.tipo,
    contenido: row.contenido,
    media_url: row.media_url,
    meta_message_id: row.meta_message_id,
    idempotency_key: row.idempotency_key,
    metadata: structuredClone(meta),
    created_at: new Date(row.created_at),
    platform_created_at: row.platform_created_at ? new Date(row.platform_created_at) : null,
    estado_entrega: row.estado_entrega,
    estado_entrega_at: row.estado_entrega_at ? new Date(row.estado_entrega_at) : null,
    error_entrega: row.error_entrega,
  };
}
