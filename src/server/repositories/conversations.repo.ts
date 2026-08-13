import { ConflictError, NotFoundError } from "@/lib/errors";
import type { Canal } from "@/types/domain";
import type { Conversacion, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

export type ConversacionInsert = Insert<Conversacion, "id" | "ultima_actividad_at">;
export type ConversacionUpdate = Update<Conversacion, "id" | "canal" | "canal_thread_id">;

export interface ConversationsRepository {
  create(input: ConversacionInsert): Promise<Conversacion>;
  findById(id: UUID): Promise<Conversacion | null>;
  findByCanalThread(canal: Canal, canalThreadId: string): Promise<Conversacion | null>;
  // Conversaciones de un lead ordenadas por ultima_actividad_at DESC (multi-canal en inbox).
  findByLeadId(leadId: UUID): Promise<Conversacion[]>;
  /**
   * Conversaciones de varios leads, de una sola consulta, en el mismo orden
   * global por `ultima_actividad_at` DESC.
   *
   * Existe para la bandeja, que necesita los canales y el hilo más activo de
   * cada fila: con un `findByLeadId` por lead eso es una consulta por fila y el
   * poller la repite cada 5 segundos. Quien llama agrupa por `lead_id`; el
   * orden global DESC hace que cada grupo quede también DESC, que es lo que
   * `findByLeadId` devuelve para un lead solo.
   */
  listByLeadIds(leadIds: UUID[]): Promise<Conversacion[]>;
  // Find or create. Throw si (canal, threadId) ya pertenece a otro lead (merge debe ser explícito).
  upsertByCanalThread(canal: Canal, canalThreadId: string, leadId: UUID): Promise<Conversacion>;
  // Marca actividad. `at` default = now.
  touch(id: UUID, at?: Date): Promise<Conversacion>;
  // Update genérico (e.g., reasignar lead_id durante merge). No permite cambiar canal/canal_thread_id.
  update(id: UUID, patch: ConversacionUpdate): Promise<Conversacion>;
}

export class InMemoryConversationsRepository implements ConversationsRepository {
  private readonly store = new Map<UUID, Conversacion>();

  async create(input: ConversacionInsert): Promise<Conversacion> {
    const dup = await this.findByCanalThread(input.canal, input.canal_thread_id);
    if (dup) {
      throw new ConflictError(
        `(canal, canal_thread_id) duplicado: (${input.canal}, ${input.canal_thread_id})`,
        "duplicate_canal_thread",
      );
    }
    const conv: Conversacion = {
      ...input,
      id: crypto.randomUUID(),
      ultima_actividad_at: new Date(),
    };
    this.store.set(conv.id, conv);
    return { ...conv };
  }

  async findById(id: UUID): Promise<Conversacion | null> {
    const c = this.store.get(id);
    return c ? { ...c } : null;
  }

  async findByCanalThread(canal: Canal, canalThreadId: string): Promise<Conversacion | null> {
    for (const c of this.store.values()) {
      if (c.canal === canal && c.canal_thread_id === canalThreadId) return { ...c };
    }
    return null;
  }

  async findByLeadId(leadId: UUID): Promise<Conversacion[]> {
    return Array.from(this.store.values())
      .filter((c) => c.lead_id === leadId)
      .sort((a, b) => b.ultima_actividad_at.getTime() - a.ultima_actividad_at.getTime())
      .map((c) => ({ ...c }));
  }

  async listByLeadIds(leadIds: UUID[]): Promise<Conversacion[]> {
    if (leadIds.length === 0) return [];
    const buscados = new Set(leadIds);
    return Array.from(this.store.values())
      .filter((c) => buscados.has(c.lead_id))
      .sort((a, b) => b.ultima_actividad_at.getTime() - a.ultima_actividad_at.getTime())
      .map((c) => ({ ...c }));
  }

  async upsertByCanalThread(
    canal: Canal,
    canalThreadId: string,
    leadId: UUID,
  ): Promise<Conversacion> {
    const existing = await this.findByCanalThread(canal, canalThreadId);
    if (existing) {
      if (existing.lead_id !== leadId) {
        throw new ConflictError(
          `(${canal}, ${canalThreadId}) ya pertenece a lead ${existing.lead_id} (esperado ${leadId})`,
          "conv_belongs_other_lead",
        );
      }
      return existing;
    }
    return this.create({ canal, canal_thread_id: canalThreadId, lead_id: leadId });
  }

  async touch(id: UUID, at?: Date): Promise<Conversacion> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`conversación no encontrada: ${id}`, "conversacion", id);
    const next: Conversacion = { ...current, ultima_actividad_at: at ?? new Date() };
    this.store.set(id, next);
    return { ...next };
  }

  async update(id: UUID, patch: ConversacionUpdate): Promise<Conversacion> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`conversación no encontrada: ${id}`, "conversacion", id);
    const next: Conversacion = {
      ...current,
      ...patch,
      id: current.id,
      canal: current.canal,
      canal_thread_id: current.canal_thread_id,
    };
    this.store.set(id, next);
    return { ...next };
  }
}
