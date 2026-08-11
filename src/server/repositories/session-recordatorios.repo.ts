import type { MotivoCancelacionRecordatorio } from "@/types/domain";
import type { SessionRecordatorio, UUID } from "@/types/entities";
import type { Insert } from "./_types";

export type SessionRecordatorioInsert = Insert<
  SessionRecordatorio,
  "id" | "created_at" | "estado" | "motivo_cancelacion" | "avisado_at" | "cancelado_at"
>;

export interface SessionRecordatoriosRepository {
  create(input: SessionRecordatorioInsert): Promise<SessionRecordatorio>;

  findById(id: UUID): Promise<SessionRecordatorio | null>;

  /**
   * El recordatorio vivo de la sesión: `pendiente` o `avisado`. Es el que
   * muestra el Twin y el que el índice único garantiza que sea uno solo.
   */
  findVivoBySessionId(sessionId: UUID): Promise<SessionRecordatorio | null>;

  /**
   * Los que tienen que encender el chip de la bandeja: los `avisado` y los
   * `pendiente` cuya fecha ya pasó.
   *
   * Lo segundo es una red y no el mecanismo —quien avisa es el workflow de
   * Inngest—, pero si el workflow no corrió, un recordatorio vencido tiene que
   * aparecer igual: el modo de falla que el dueño no acepta es que desaparezca
   * en silencio.
   */
  listPorAvisar(now: Date): Promise<SessionRecordatorio[]>;

  /**
   * `pendiente` → `avisado`. Devuelve `null` si la fila no existe o ya no
   * estaba pendiente (cancelada, o un replay del workflow): es la guarda que
   * hace idempotente al despertar del `sleepUntil`.
   */
  marcarAvisado(id: UUID, at?: Date): Promise<SessionRecordatorio | null>;

  /**
   * Apaga el recordatorio. Devuelve `null` si no existe o ya estaba cancelado
   * —cancelar dos veces no es un error, la fila pudo apagarse en otra pestaña—.
   */
  cancelar(
    id: UUID,
    motivo: MotivoCancelacionRecordatorio,
    at?: Date,
  ): Promise<SessionRecordatorio | null>;

  /**
   * Apaga todos los recordatorios vivos de una sesión. Lo llama el pipeline
   * cuando entra un mensaje del cliente. Devuelve cuántos apagó.
   */
  cancelarVivosDeSesion(
    sessionId: UUID,
    motivo: MotivoCancelacionRecordatorio,
    at?: Date,
  ): Promise<number>;
}

const ESTADOS_VIVOS = ["pendiente", "avisado"] as const;

function esVivo(r: SessionRecordatorio): boolean {
  return (ESTADOS_VIVOS as readonly string[]).includes(r.estado);
}

/**
 * Default para los callers que todavía no tienen recordatorios wireados —el
 * pipeline de mensajes entrantes, sobre todo—. Mismo criterio que
 * `NoopReactivationDispatchesRepository`: no rompe, no guarda nada.
 */
export class NoopSessionRecordatoriosRepository implements SessionRecordatoriosRepository {
  async create(input: SessionRecordatorioInsert): Promise<SessionRecordatorio> {
    return {
      ...input,
      id: crypto.randomUUID(),
      estado: "pendiente",
      motivo_cancelacion: null,
      created_at: new Date(),
      avisado_at: null,
      cancelado_at: null,
    };
  }
  async findById(_id: UUID): Promise<SessionRecordatorio | null> {
    return null;
  }
  async findVivoBySessionId(_sessionId: UUID): Promise<SessionRecordatorio | null> {
    return null;
  }
  async listPorAvisar(_now: Date): Promise<SessionRecordatorio[]> {
    return [];
  }
  async marcarAvisado(_id: UUID, _at?: Date): Promise<SessionRecordatorio | null> {
    return null;
  }
  async cancelar(
    _id: UUID,
    _motivo: MotivoCancelacionRecordatorio,
    _at?: Date,
  ): Promise<SessionRecordatorio | null> {
    return null;
  }
  async cancelarVivosDeSesion(
    _sessionId: UUID,
    _motivo: MotivoCancelacionRecordatorio,
    _at?: Date,
  ): Promise<number> {
    return 0;
  }
}

export class InMemorySessionRecordatoriosRepository implements SessionRecordatoriosRepository {
  private readonly store = new Map<UUID, SessionRecordatorio>();

  async create(input: SessionRecordatorioInsert): Promise<SessionRecordatorio> {
    // Espeja el índice único parcial de la tabla: sin esto los tests pasarían
    // con dos recordatorios vivos sobre la misma sesión, que la DB rechaza.
    const vivo = await this.findVivoBySessionId(input.lead_session_id);
    if (vivo) {
      throw new Error(`ya hay un recordatorio vivo para la sesión ${input.lead_session_id}`);
    }
    const row: SessionRecordatorio = {
      ...input,
      id: crypto.randomUUID(),
      estado: "pendiente",
      motivo_cancelacion: null,
      created_at: new Date(),
      avisado_at: null,
      cancelado_at: null,
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findById(id: UUID): Promise<SessionRecordatorio | null> {
    const r = this.store.get(id);
    return r ? { ...r } : null;
  }

  async findVivoBySessionId(sessionId: UUID): Promise<SessionRecordatorio | null> {
    const r = Array.from(this.store.values()).find(
      (x) => x.lead_session_id === sessionId && esVivo(x),
    );
    return r ? { ...r } : null;
  }

  async listPorAvisar(now: Date): Promise<SessionRecordatorio[]> {
    return Array.from(this.store.values())
      .filter(
        (r) =>
          r.estado === "avisado" ||
          (r.estado === "pendiente" && r.recordar_at.getTime() <= now.getTime()),
      )
      .sort((a, b) => a.recordar_at.getTime() - b.recordar_at.getTime())
      .map((r) => ({ ...r }));
  }

  async marcarAvisado(id: UUID, at: Date = new Date()): Promise<SessionRecordatorio | null> {
    const r = this.store.get(id);
    if (!r || r.estado !== "pendiente") return null;
    r.estado = "avisado";
    r.avisado_at = at;
    return { ...r };
  }

  async cancelar(
    id: UUID,
    motivo: MotivoCancelacionRecordatorio,
    at: Date = new Date(),
  ): Promise<SessionRecordatorio | null> {
    const r = this.store.get(id);
    if (!r || !esVivo(r)) return null;
    r.estado = "cancelado";
    r.motivo_cancelacion = motivo;
    r.cancelado_at = at;
    return { ...r };
  }

  async cancelarVivosDeSesion(
    sessionId: UUID,
    motivo: MotivoCancelacionRecordatorio,
    at: Date = new Date(),
  ): Promise<number> {
    let n = 0;
    for (const r of this.store.values()) {
      if (r.lead_session_id !== sessionId || !esVivo(r)) continue;
      r.estado = "cancelado";
      r.motivo_cancelacion = motivo;
      r.cancelado_at = at;
      n++;
    }
    return n;
  }
}
