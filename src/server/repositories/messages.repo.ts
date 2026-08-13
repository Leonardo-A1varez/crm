import { ConflictError, NotFoundError } from "@/lib/errors";
import { esAvance } from "@/lib/entrega";
import type { Direction, EstadoEntrega, Sender } from "@/types/domain";
import type { Mensaje, UUID } from "@/types/entities";
import type { Insert } from "./_types";

// Los tres campos de entrega quedan fuera del insert: los escribe el webhook
// de status de Meta, nunca quien crea el mensaje.
export type MensajeInsert = Insert<
  Mensaje,
  "id" | "created_at" | "estado_entrega" | "estado_entrega_at" | "error_entrega"
>;

export interface EstadoEntregaPatch {
  estado: EstadoEntrega;
  at: Date;
  error: string | null;
}

export interface ListByConversacionFilter {
  limit?: number;
  // Cursor: solo mensajes con created_at < `before`. Para paginación hacia atrás.
  before?: Date;
}

export interface ListBySessionFilter {
  // Conserva los N más recientes (el thread muestra el final de la conversación).
  limit?: number;
}

const DEFAULT_LIMIT = 50;

/**
 * Un mensaje cuyo texto coincidió con la búsqueda, con lo mínimo para mostrarlo.
 *
 * No devuelve el `Mensaje` entero a propósito: el buscador dibuja una línea por
 * conversación y traer `metadata` de cientos de filas para descartarla es pagar
 * ancho de banda por nada.
 */
export interface CoincidenciaContenido {
  mensajeId: UUID;
  leadSessionId: UUID;
  contenido: string;
  direction: Direction;
  createdAt: Date;
}

export interface BuscarContenidoFilter {
  /** Tope duro de filas. Sin esto una búsqueda de "a" se trae la tabla. */
  limit: number;
}

/** Proyección mínima y sin metadata para el refresco recurrente del Inbox. */
export interface InboxRecentMessage {
  conversacion_id: UUID;
  lead_session_id: UUID;
  direction: Direction;
  sender: Sender;
  contenido: string | null;
  created_at: Date;
}

// Deep clone defensivo de metadata (jsonb arbitrario). Garantiza parity con Supabase.
function cloneMensaje(m: Mensaje): Mensaje {
  return { ...m, metadata: structuredClone(m.metadata) };
}

export interface MessagesRepository {
  create(input: MensajeInsert): Promise<Mensaje>;
  findById(id: UUID): Promise<Mensaje | null>;
  // Dedup webhook Meta. Null cuando meta_message_id no fue persistido.
  findByMetaMessageId(metaMessageId: string): Promise<Mensaje | null>;
  // Dedup outbound retry. Espeja UNIQUE partial WHERE direction='out' AND idempotency_key IS NOT NULL.
  findByIdempotencyKey(key: string): Promise<Mensaje | null>;
  // Timeline inbox: orden created_at DESC. limit default 50.
  listByConversacion(conversacionId: UUID, filter?: ListByConversacionFilter): Promise<Mensaje[]>;
  // Thread de la sesión cruzando conversaciones (multi-canal). Orden ASC
  // (viejo→nuevo); con limit conserva los N más recientes.
  listBySessionId(sessionId: UUID, filter?: ListBySessionFilter): Promise<Mensaje[]>;
  /**
   * Hilos de varias sesiones de una sola vez, orden ASC global.
   *
   * Existe para que la lista de leads pueda decidir cuáles quedaron sin
   * responder sin pedir un hilo por lead: con 1000 leads en pantalla ese N+1
   * sería la consulta más cara del panel. Quien llama agrupa por
   * `lead_session_id`.
   */
  listBySessionIds(sessionIds: UUID[]): Promise<Mensaje[]>;
  /**
   * Cola acotada de cada sesión, ASC global. Es el read model del poller de
   * Inbox: evita descargar el historial entero para calcular preview y triage.
   */
  listRecentBySessionIds(sessionIds: UUID[], limit: number): Promise<InboxRecentMessage[]>;
  /**
   * Mensajes cuyo texto contiene `q`, del más reciente al más viejo.
   *
   * Es el corazón del buscador del Inbox y la única consulta del panel que
   * mira el texto de los mensajes. Va contra `mensajes.contenido` con un LIKE
   * de subcadena, que en Postgres se apoya en el índice trigram
   * `mensajes_contenido_trgm_idx` (migración `20260811160000`); ese índice
   * necesita 3 caracteres para tener trigramas que buscar, y quien llama es
   * responsable de no pedir menos. Ver el comentario de la migración.
   *
   * Devuelve `lead_session_id` y no el lead: el mapeo sesión→lead lo resuelve
   * `LeadSessionRepository.listByIds` de una sola vez, no una consulta por
   * mensaje.
   */
  buscarContenido(q: string, filter: BuscarContenidoFilter): Promise<CoincidenciaContenido[]>;
  /**
   * Completa una reserva con el id que devolvió Meta.
   *
   * Existe porque el saliente se escribe ANTES de llamar a Meta: si se
   * escribiera después, un fallo de la escritura haría que el reintento
   * volviera a llamar a Meta y el cliente recibiera el mensaje dos veces.
   */
  confirmarEnvio(id: UUID, metaMessageId: string): Promise<Mensaje>;
  /**
   * Deja la reserva marcada como fallida con el motivo.
   *
   * `MessageBubble` ya pinta `estado_entrega === "fallido"` junto con
   * `error_entrega`, así que un envío que no se pudo confirmar se ve en el
   * hilo sin construir nada nuevo.
   */
  marcarFalloEnvio(id: UUID, error: string): Promise<Mensaje>;
  /**
   * Borra una reserva que Meta rechazó explícitamente, liberando su
   * `idempotency_key` para que el reintento pueda volver a intentar.
   *
   * Lanza `ConflictError` si la fila ya tiene `meta_message_id`: eso significa
   * que Meta la aceptó y borrarla perdería el mensaje.
   */
  liberarReserva(id: UUID): Promise<void>;
  // Estado de entrega desde el webhook de Meta. `meta_message_id` desconocido
  // = no-op y devuelve null: Meta reporta estados de mensajes que no mandamos
  // nosotros (plantillas disparadas desde su consola) y no son un error.
  aplicarEstadoEntrega(metaMessageId: string, patch: EstadoEntregaPatch): Promise<Mensaje | null>;
}

export class InMemoryMessagesRepository implements MessagesRepository {
  private readonly store = new Map<UUID, Mensaje>();

  async create(input: MensajeInsert): Promise<Mensaje> {
    if (
      input.direction === "out" &&
      input.idempotency_key !== null &&
      input.idempotency_key !== undefined
    ) {
      const dup = await this.findByIdempotencyKey(input.idempotency_key);
      if (dup) {
        throw new ConflictError(
          `idempotency_key duplicado: ${input.idempotency_key}`,
          "duplicate_idempotency_key",
        );
      }
    }
    if (input.meta_message_id !== null && input.meta_message_id !== undefined) {
      const dup = await this.findByMetaMessageId(input.meta_message_id);
      if (dup) {
        throw new ConflictError(
          `meta_message_id duplicado: ${input.meta_message_id}`,
          "duplicate_meta_message_id",
        );
      }
    }
    const msg: Mensaje = {
      ...input,
      platform_created_at: input.platform_created_at ?? null,
      metadata: structuredClone(input.metadata),
      id: crypto.randomUUID(),
      created_at: new Date(),
      estado_entrega: null,
      estado_entrega_at: null,
      error_entrega: null,
    };
    this.store.set(msg.id, msg);
    return cloneMensaje(msg);
  }

  async findById(id: UUID): Promise<Mensaje | null> {
    const m = this.store.get(id);
    return m ? cloneMensaje(m) : null;
  }

  async findByMetaMessageId(metaMessageId: string): Promise<Mensaje | null> {
    for (const m of this.store.values()) {
      if (m.meta_message_id !== null && m.meta_message_id === metaMessageId) {
        return cloneMensaje(m);
      }
    }
    return null;
  }

  async findByIdempotencyKey(key: string): Promise<Mensaje | null> {
    for (const m of this.store.values()) {
      if (m.direction === "out" && m.idempotency_key === key) {
        return cloneMensaje(m);
      }
    }
    return null;
  }

  async listByConversacion(
    conversacionId: UUID,
    filter: ListByConversacionFilter = {},
  ): Promise<Mensaje[]> {
    const limit = filter.limit ?? DEFAULT_LIMIT;
    let rows = Array.from(this.store.values()).filter((m) => m.conversacion_id === conversacionId);
    if (filter.before) {
      const ts = filter.before.getTime();
      rows = rows.filter((m) => m.created_at.getTime() < ts);
    }
    rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return rows.slice(0, limit).map(cloneMensaje);
  }

  async listBySessionId(sessionId: UUID, filter: ListBySessionFilter = {}): Promise<Mensaje[]> {
    const limit = filter.limit ?? DEFAULT_LIMIT;
    const rows = Array.from(this.store.values()).filter((m) => m.lead_session_id === sessionId);
    rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    return rows.slice(-limit).map(cloneMensaje);
  }

  async listBySessionIds(sessionIds: UUID[]): Promise<Mensaje[]> {
    if (sessionIds.length === 0) return [];
    const wanted = new Set(sessionIds);
    return Array.from(this.store.values())
      .filter((m) => m.lead_session_id !== null && wanted.has(m.lead_session_id))
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map(cloneMensaje);
  }

  async listRecentBySessionIds(sessionIds: UUID[], limit: number): Promise<InboxRecentMessage[]> {
    if (sessionIds.length === 0 || limit <= 0) return [];
    const wanted = new Set(sessionIds);
    const bySession = new Map<UUID, Mensaje[]>();
    for (const message of this.store.values()) {
      if (!wanted.has(message.lead_session_id)) continue;
      const bucket = bySession.get(message.lead_session_id) ?? [];
      bucket.push(message);
      bySession.set(message.lead_session_id, bucket);
    }
    return Array.from(bySession.values())
      .flatMap((rows) =>
        rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime()).slice(-limit),
      )
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map((message) => ({
        conversacion_id: message.conversacion_id,
        lead_session_id: message.lead_session_id,
        direction: message.direction,
        sender: message.sender,
        contenido: message.contenido,
        created_at: message.created_at,
      }));
  }

  async buscarContenido(
    q: string,
    filter: BuscarContenidoFilter,
  ): Promise<CoincidenciaContenido[]> {
    if (q === "") return [];
    // `toLowerCase` y no `plegar`: espeja el ILIKE de Postgres, que ignora
    // mayúsculas pero NO tildes. Plegar acá haría que el contract pasara en
    // memoria y fallara contra Supabase.
    const aguja = q.toLowerCase();
    return Array.from(this.store.values())
      .filter((m) => m.contenido !== null && m.contenido.toLowerCase().includes(aguja))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, filter.limit)
      .map((m) => ({
        mensajeId: m.id,
        leadSessionId: m.lead_session_id,
        contenido: m.contenido ?? "",
        direction: m.direction,
        createdAt: m.created_at,
      }));
  }

  async confirmarEnvio(id: UUID, metaMessageId: string): Promise<Mensaje> {
    const m = this.store.get(id);
    if (!m) throw new NotFoundError(`mensaje no encontrado: ${id}`, "mensaje", id);
    m.meta_message_id = metaMessageId;
    return cloneMensaje(m);
  }

  async marcarFalloEnvio(id: UUID, error: string): Promise<Mensaje> {
    const m = this.store.get(id);
    if (!m) throw new NotFoundError(`mensaje no encontrado: ${id}`, "mensaje", id);
    m.estado_entrega = "fallido";
    m.estado_entrega_at = new Date();
    m.error_entrega = error;
    return cloneMensaje(m);
  }

  async liberarReserva(id: UUID): Promise<void> {
    const m = this.store.get(id);
    if (!m) return;
    if (m.meta_message_id !== null) {
      throw new ConflictError(
        `mensaje ya confirmado por Meta, no se libera: ${id}`,
        "reserva_confirmada",
      );
    }
    this.store.delete(id);
  }

  async aplicarEstadoEntrega(
    metaMessageId: string,
    patch: EstadoEntregaPatch,
  ): Promise<Mensaje | null> {
    for (const m of this.store.values()) {
      if (m.meta_message_id !== metaMessageId) continue;
      if (!esAvance(m.estado_entrega, patch.estado)) return cloneMensaje(m);
      m.estado_entrega = patch.estado;
      m.estado_entrega_at = patch.at;
      m.error_entrega = patch.error;
      return cloneMensaje(m);
    }
    return null;
  }
}
