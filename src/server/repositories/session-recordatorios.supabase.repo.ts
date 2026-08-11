import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { EstadoRecordatorio, MotivoCancelacionRecordatorio } from "@/types/domain";
import type { SessionRecordatorio, UUID } from "@/types/entities";
import type {
  SessionRecordatorioInsert,
  SessionRecordatoriosRepository,
} from "./session-recordatorios.repo";

const TABLA = "session_recordatorios";
const RECURSO = "session_recordatorio";

/** Los dos estados que cuentan como "todavía tiene efecto". */
const VIVOS: readonly EstadoRecordatorio[] = ["pendiente", "avisado"];

/**
 * Impl Supabase de `SessionRecordatoriosRepository`.
 *
 * Las transiciones de estado se escriben como UPDATE condicional
 * (`.eq("estado", …)` / `.in("estado", …)`) y no como "leo, decido, escribo":
 * dos pestañas o un replay del workflow pueden cancelar y avisar el mismo
 * recordatorio a la vez, y el filtro en el WHERE es lo que hace que gane uno
 * solo. `null` de vuelta significa "la fila ya no estaba en ese estado", que es
 * un no-op legítimo y no un error.
 */
export class SupabaseSessionRecordatoriosRepository implements SessionRecordatoriosRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: SessionRecordatorioInsert): Promise<SessionRecordatorio> {
    const { data, error } = await this.db
      .from(TABLA)
      .insert({
        lead_session_id: input.lead_session_id,
        recordar_at: input.recordar_at.toISOString(),
        nota: input.nota,
        creado_por: input.creado_por,
      })
      .select()
      .single();

    // El índice único parcial convierte "ya hay uno vivo" en 23505, que
    // `mapPostgrestError` traduce a ConflictError. La guarda del service es la
    // que da el mensaje lindo; esta es la que cierra la carrera.
    if (error) throw mapPostgrestError(error, { resource: RECURSO });
    return mapRow(data);
  }

  async findById(id: UUID): Promise<SessionRecordatorio | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from(TABLA).select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: RECURSO });
    return data ? mapRow(data) : null;
  }

  async findVivoBySessionId(sessionId: UUID): Promise<SessionRecordatorio | null> {
    if (!isUuid(sessionId)) return null;
    const { data, error } = await this.db
      .from(TABLA)
      .select()
      .eq("lead_session_id", sessionId)
      .in("estado", [...VIVOS])
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: RECURSO });
    return data ? mapRow(data) : null;
  }

  async listPorAvisar(now: Date): Promise<SessionRecordatorio[]> {
    // `avisado` (el workflow ya pasó) o `pendiente` con la fecha cumplida (el
    // workflow todavía no pasó, pero el vendedor no tiene por qué enterarse de
    // que Inngest está atrasado).
    const { data, error } = await this.db
      .from(TABLA)
      .select()
      .in("estado", [...VIVOS])
      .lte("recordar_at", now.toISOString())
      .order("recordar_at", { ascending: true });
    if (error) throw mapPostgrestError(error, { resource: RECURSO });
    return (data ?? []).map(mapRow);
  }

  async marcarAvisado(id: UUID, at: Date = new Date()): Promise<SessionRecordatorio | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from(TABLA)
      .update({ estado: "avisado", avisado_at: at.toISOString() })
      .eq("id", id)
      .eq("estado", "pendiente")
      .select()
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: RECURSO });
    return data ? mapRow(data) : null;
  }

  async cancelar(
    id: UUID,
    motivo: MotivoCancelacionRecordatorio,
    at: Date = new Date(),
  ): Promise<SessionRecordatorio | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from(TABLA)
      .update({
        estado: "cancelado",
        motivo_cancelacion: motivo,
        cancelado_at: at.toISOString(),
      })
      .eq("id", id)
      .in("estado", [...VIVOS])
      .select()
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: RECURSO });
    return data ? mapRow(data) : null;
  }

  async cancelarVivosDeSesion(
    sessionId: UUID,
    motivo: MotivoCancelacionRecordatorio,
    at: Date = new Date(),
  ): Promise<number> {
    if (!isUuid(sessionId)) return 0;
    const { data, error } = await this.db
      .from(TABLA)
      .update({
        estado: "cancelado",
        motivo_cancelacion: motivo,
        cancelado_at: at.toISOString(),
      })
      .eq("lead_session_id", sessionId)
      .in("estado", [...VIVOS])
      .select("id");
    if (error) throw mapPostgrestError(error, { resource: RECURSO });
    return (data ?? []).length;
  }
}

interface SessionRecordatorioRow {
  id: string;
  lead_session_id: string;
  recordar_at: string;
  nota: string;
  estado: string;
  motivo_cancelacion: string | null;
  creado_por: string | null;
  created_at: string;
  avisado_at: string | null;
  cancelado_at: string | null;
}

function mapRow(row: SessionRecordatorioRow): SessionRecordatorio {
  return {
    id: row.id,
    lead_session_id: row.lead_session_id,
    recordar_at: new Date(row.recordar_at),
    nota: row.nota,
    // La DB guarda `text` con CHECK; la entidad angosta a la unión. El CHECK es
    // el que sostiene el cast — no hay forma de escribir otro valor.
    estado: row.estado as EstadoRecordatorio,
    motivo_cancelacion: row.motivo_cancelacion as MotivoCancelacionRecordatorio | null,
    creado_por: row.creado_por,
    created_at: new Date(row.created_at),
    avisado_at: row.avisado_at ? new Date(row.avisado_at) : null,
    cancelado_at: row.cancelado_at ? new Date(row.cancelado_at) : null,
  };
}
