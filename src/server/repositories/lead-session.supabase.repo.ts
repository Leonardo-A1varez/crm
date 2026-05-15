import { ConflictError, IllegalStateError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { serverNowIso } from "@/server/db/server-time";
import type { Database } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { CurrentStage, MetodoPago, MotivoPerdida, Resultado, Urgencia } from "@/types/domain";
import type { LeadSession, UUID } from "@/types/entities";
import type {
  CloseInput,
  LeadSessionInsert,
  LeadSessionRepository,
  LeadSessionUpdate,
} from "./lead-session.repo";

type LeadSessionDbUpdate = Database["public"]["Tables"]["lead_session"]["Update"];

/**
 * Supabase impl LeadSessionRepository. Slice 1 sub-paso 7.4 repo 9.
 *
 * FK lead_id → leads.id ON DELETE CASCADE.
 *
 * UNIQUE partial: lead_session_unique_activa_idx (lead_id) WHERE resultado IS NULL
 *   → enforce máx 1 sesión activa per lead atomic.
 *
 * close idempotente: SELECT actual → match resultado/motivo → return existing
 * (replay-safe). Mismatch → IllegalStateError NonRetriable. No race-protected
 * (entre SELECT y UPDATE alguien podría cerrar); contract tolera porque
 * single-process workflow per session en práctica.
 */
export class SupabaseLeadSessionRepository implements LeadSessionRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: LeadSessionInsert): Promise<LeadSession> {
    const { data, error } = await this.db
      .from("lead_session")
      .insert({
        lead_id: input.lead_id,
        current_stage: input.current_stage,
        urgencia: input.urgencia,
        consulta: input.consulta,
        producto_cotizado_id: input.producto_cotizado_id,
        codigo_interno: input.codigo_interno,
        precio_cotizado: input.precio_cotizado,
        cantidad: input.cantidad,
        bloqueador: input.bloqueador,
        comprobante_pago_url: input.comprobante_pago_url,
        metodo_pago: input.metodo_pago,
        resultado: input.resultado,
        motivo_perdida: input.motivo_perdida,
        ia_pausada: input.ia_pausada,
        extras: (input.extras ?? {}) as never,
        context_summary: input.context_summary ?? null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        const msg = error.message ?? "";
        if (msg.includes("lead_session_unique_activa_idx")) {
          throw new ConflictError(
            `ya existe sesión activa para lead ${input.lead_id}`,
            "active_session_exists",
            error,
          );
        }
        throw new ConflictError(msg, "unique_violation", error);
      }
      throw mapPostgrestError(error, { resource: "lead_session" });
    }
    return mapRow(data);
  }

  async findById(id: UUID): Promise<LeadSession | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("lead_session").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return data ? mapRow(data) : null;
  }

  async findActiveByLeadId(leadId: UUID): Promise<LeadSession | null> {
    if (!isUuid(leadId)) return null;
    const { data, error } = await this.db
      .from("lead_session")
      .select()
      .eq("lead_id", leadId)
      .is("resultado", null)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return data ? mapRow(data) : null;
  }

  async update(id: UUID, patch: LeadSessionUpdate): Promise<LeadSession> {
    const updatePayload: LeadSessionDbUpdate = {};
    // id, lead_id, started_at, closed_at, resultado, motivo_perdida NO mapeados
    // (defense runtime — type Update<...> los omite igualmente).
    if (patch.current_stage !== undefined) updatePayload.current_stage = patch.current_stage;
    if (patch.urgencia !== undefined) updatePayload.urgencia = patch.urgencia;
    if (patch.consulta !== undefined) updatePayload.consulta = patch.consulta;
    if (patch.producto_cotizado_id !== undefined) {
      updatePayload.producto_cotizado_id = patch.producto_cotizado_id;
    }
    if (patch.codigo_interno !== undefined) updatePayload.codigo_interno = patch.codigo_interno;
    if (patch.precio_cotizado !== undefined) updatePayload.precio_cotizado = patch.precio_cotizado;
    if (patch.cantidad !== undefined) updatePayload.cantidad = patch.cantidad;
    if (patch.bloqueador !== undefined) updatePayload.bloqueador = patch.bloqueador;
    if (patch.comprobante_pago_url !== undefined) {
      updatePayload.comprobante_pago_url = patch.comprobante_pago_url;
    }
    if (patch.metodo_pago !== undefined) updatePayload.metodo_pago = patch.metodo_pago;
    if (patch.ia_pausada !== undefined) updatePayload.ia_pausada = patch.ia_pausada;
    if (patch.extras !== undefined) updatePayload.extras = patch.extras as never;
    if (patch.context_summary !== undefined) {
      updatePayload.context_summary = patch.context_summary;
    }

    const { data, error } = await this.db
      .from("lead_session")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    if (data === null) {
      throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    }
    return mapRow(data);
  }

  async close(id: UUID, input: CloseInput): Promise<LeadSession> {
    const current = await this.findById(id);
    if (!current) {
      throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    }
    if (current.resultado !== null) {
      const requestedMotivo = input.motivo_perdida ?? null;
      if (current.resultado === input.resultado && current.motivo_perdida === requestedMotivo) {
        return current;
      }
      throw new IllegalStateError(
        `sesión ya cerrada con resultado distinto (current=${current.resultado}/${current.motivo_perdida ?? "null"}, requested=${input.resultado}/${requestedMotivo ?? "null"})`,
        "session_already_closed_different",
      );
    }

    const closedAt = await serverNowIso(this.db);
    const { data, error } = await this.db
      .from("lead_session")
      .update({
        resultado: input.resultado,
        motivo_perdida: input.motivo_perdida ?? null,
        closed_at: closedAt,
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    if (data === null) {
      throw new NotFoundError(`sesión no encontrada: ${id}`, "lead_session", id);
    }
    return mapRow(data);
  }

  async listClosedBefore(date: Date): Promise<LeadSession[]> {
    const { data, error } = await this.db
      .from("lead_session")
      .select()
      .lt("closed_at", date.toISOString())
      .not("closed_at", "is", null);
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return (data ?? []).map(mapRow);
  }
}

interface LeadSessionRow {
  id: string;
  lead_id: string;
  current_stage: CurrentStage;
  urgencia: Urgencia;
  consulta: string;
  producto_cotizado_id: string | null;
  codigo_interno: string | null;
  precio_cotizado: number | null;
  cantidad: number | null;
  bloqueador: string | null;
  comprobante_pago_url: string | null;
  metodo_pago: MetodoPago | null;
  resultado: Resultado | null;
  motivo_perdida: MotivoPerdida | null;
  ia_pausada: boolean;
  extras: unknown;
  context_summary: string | null;
  started_at: string;
  closed_at: string | null;
}

function mapRow(row: LeadSessionRow): LeadSession {
  const extras = (row.extras ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    lead_id: row.lead_id,
    current_stage: row.current_stage,
    urgencia: row.urgencia,
    consulta: row.consulta,
    producto_cotizado_id: row.producto_cotizado_id,
    codigo_interno: row.codigo_interno,
    precio_cotizado: row.precio_cotizado,
    cantidad: row.cantidad,
    bloqueador: row.bloqueador,
    comprobante_pago_url: row.comprobante_pago_url,
    metodo_pago: row.metodo_pago,
    resultado: row.resultado,
    motivo_perdida: row.motivo_perdida,
    ia_pausada: row.ia_pausada,
    extras: structuredClone(extras),
    context_summary: row.context_summary,
    started_at: new Date(row.started_at),
    closed_at: row.closed_at ? new Date(row.closed_at) : null,
  };
}
