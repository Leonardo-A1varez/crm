import { ConflictError } from "@/lib/errors";
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
   * Los recordatorios vivos de esas sesiones, del más próximo al más lejano.
   *
   * Distinto de `listPorAvisar`: ese trae solo los que ya vencieron —lo que el
   * triage necesita— y este trae también los futuros, que es lo que muestra el
   * filtro de Seguimiento de la bandeja. Un seguimiento para mañana todavía no
   * reclama atención pero sí tiene que poder listarse.
   *
   * Acotado a las sesiones que la bandeja ya está listando: sin el recorte, la
   * consulta crecería con el histórico entero de la instalación.
   */
  listVivosBySessionIds(sessionIds: UUID[]): Promise<SessionRecordatorio[]>;

  /**
   * `pendiente` → `avisado`. Devuelve `null` si la fila no existe o ya no
   * estaba pendiente (cancelada, o un replay del workflow): es la guarda que
   * hace idempotente al despertar del `sleepUntil`.
   *
   * `esperadoRecordarAt` es la segunda guarda, la que sostiene el reprogramar:
   * el workflow que se durmió con la fecha vieja se despierta igual, encuentra
   * la fila **todavía pendiente** con otra fecha y no tiene que avisar. La
   * comparación es exacta contra la fecha que traía el evento, así no depende
   * de relojes ni de tolerancias.
   */
  marcarAvisado(
    id: UUID,
    opts?: { at?: Date; esperadoRecordarAt?: Date },
  ): Promise<SessionRecordatorio | null>;

  /**
   * Le cambia la fecha —y opcionalmente la nota— a un recordatorio vivo sin
   * cancelarlo ni crear otro. Devuelve `null` si la fila no existe o ya no está
   * viva.
   *
   * Un `avisado` vuelve a `pendiente` y pierde `avisado_at`: posponer el que ya
   * sonó es el caso más común de reprogramar —"hoy no llegué, mañana"— y
   * partirlo en cancelar + crear rompería el índice único en el medio y dejaría
   * dos filas donde el producto dice que hay una cita. Se pierde el sello del
   * aviso anterior; lo que se quería medir —cuántos seguimientos se apagaron
   * porque el cliente volvió— vive en `motivo_cancelacion` y no se toca.
   *
   * `nota` en `undefined` deja la columna como está: el default de este repo es
   * no tocarla, y quien la quiera vaciar tiene que mandar `""` a propósito. La
   * decisión de qué cuenta como "a propósito" es del service (`notaAEscribir`).
   */
  reprogramar(id: UUID, recordarAt: Date, nota?: string): Promise<SessionRecordatorio | null>;

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
  async listVivosBySessionIds(_sessionIds: UUID[]): Promise<SessionRecordatorio[]> {
    return [];
  }
  async marcarAvisado(
    _id: UUID,
    _opts?: { at?: Date; esperadoRecordarAt?: Date },
  ): Promise<SessionRecordatorio | null> {
    return null;
  }
  async reprogramar(
    _id: UUID,
    _recordarAt: Date,
    _nota?: string,
  ): Promise<SessionRecordatorio | null> {
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
      throw new ConflictError(
        `ya hay un recordatorio vivo para la sesión ${input.lead_session_id}`,
        "active_reminder_exists",
      );
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

  async listVivosBySessionIds(sessionIds: UUID[]): Promise<SessionRecordatorio[]> {
    if (sessionIds.length === 0) return [];
    const buscadas = new Set(sessionIds);
    return Array.from(this.store.values())
      .filter(
        (r) =>
          buscadas.has(r.lead_session_id) && (r.estado === "pendiente" || r.estado === "avisado"),
      )
      .sort((a, b) => a.recordar_at.getTime() - b.recordar_at.getTime())
      .map((r) => ({ ...r }));
  }

  async marcarAvisado(
    id: UUID,
    opts: { at?: Date; esperadoRecordarAt?: Date } = {},
  ): Promise<SessionRecordatorio | null> {
    const r = this.store.get(id);
    if (!r || r.estado !== "pendiente") return null;
    // La fila se reprogramó mientras este workflow dormía: el que tiene que
    // avisar es el otro, el que arrancó con la fecha nueva.
    if (opts.esperadoRecordarAt && r.recordar_at.getTime() !== opts.esperadoRecordarAt.getTime()) {
      return null;
    }
    r.estado = "avisado";
    r.avisado_at = opts.at ?? new Date();
    return { ...r };
  }

  async reprogramar(
    id: UUID,
    recordarAt: Date,
    nota?: string,
  ): Promise<SessionRecordatorio | null> {
    const r = this.store.get(id);
    if (!r || !esVivo(r)) return null;
    r.recordar_at = recordarAt;
    if (nota !== undefined) r.nota = nota;
    r.estado = "pendiente";
    r.avisado_at = null;
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
