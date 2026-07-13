import { ConflictError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { Direction, Sender, TipoMensaje } from "@/types/domain";
import type { Mensaje, MensajeMetadata, UUID } from "@/types/entities";
import type {
  ListByConversacionFilter,
  ListBySessionFilter,
  MensajeInsert,
  MessagesRepository,
} from "./messages.repo";

const DEFAULT_LIMIT = 50;

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
  };
}
