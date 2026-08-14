import { ConflictError, InfraError, NotFoundError, ValidationError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Lead, UUID } from "@/types/entities";
import type {
  ApproveLeadMergeInput,
  FusionRegistrada,
  LeadMergeRepository,
} from "./lead-merge.repo";

type MergeErrorCode =
  | "candidate_not_found"
  | "candidate_resolved"
  | "invalid_keep"
  | "both_active"
  | "lead_not_found";

type RevertErrorCode =
  | "action_not_found"
  | "not_a_merge"
  | "payload_too_old"
  | "already_reverted"
  | "ganador_not_found"
  | "lead_exists"
  | "telefono_taken"
  | "sesiones_activas_duplicadas";

interface ApproveLeadMergeRow {
  ganador_id: string | null;
  error_code: MergeErrorCode | null;
}

interface RevertLeadMergeRow {
  perdedor_id: string | null;
  error_code: RevertErrorCode | null;
}

interface AccionMergeRow {
  id: string;
  created_at: string;
  payload: {
    payload_version?: number;
    perdedor?: unknown;
  } | null;
}

/**
 * El lead borrado, tal como quedó serializado en el payload.
 *
 * Las fechas viajaron como texto por el jsonb y hay que devolverlas a `Date`:
 * el resto de la app las trata como tales y una string acá haría fallar
 * cualquier `.getTime()` río abajo.
 */
function leadDelPayload(crudo: unknown): Lead {
  const p = crudo as Record<string, unknown>;
  return {
    ...(p as unknown as Lead),
    created_at: new Date(String(p["created_at"])),
    updated_at: new Date(String(p["updated_at"])),
  };
}

/**
 * El merge toca seis tablas relacionadas. Solo una RPC puede mantener locks,
 * validaciones y escrituras dentro de la misma transacción Postgres.
 */
export class SupabaseLeadMergeRepository implements LeadMergeRepository {
  constructor(private readonly db: AppClient) {}

  async approve(input: ApproveLeadMergeInput): Promise<{ ganadorId: UUID }> {
    const { data, error } = await this.db.rpc("approve_lead_merge", {
      p_candidate_id: input.candidateId,
      p_keep_lead_id: input.keepLeadId,
    });
    if (error) throw mapPostgrestError(error, { resource: "lead_merge" });

    const row = (data as ApproveLeadMergeRow[] | null)?.[0];
    if (!row) {
      throw new InfraError("approve_lead_merge no devolvió resultado", "postgrest");
    }
    if (row.error_code !== null) this.throwDomainError(row.error_code, input);
    if (row.ganador_id === null) {
      throw new InfraError("approve_lead_merge devolvió ganador nulo", "postgrest");
    }
    return { ganadorId: row.ganador_id };
  }

  async listByLeadId(leadId: UUID): Promise<FusionRegistrada[]> {
    const { data, error } = await this.db
      .from("admin_actions")
      .select("id, created_at, payload")
      .eq("action", "lead.merge")
      .eq("entity_id", leadId)
      .order("created_at", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "admin_actions" });

    const filas = (data ?? []) as AccionMergeRow[];
    if (filas.length === 0) return [];

    // Las reversiones ya hechas, en una sola lectura: preguntar por cada fusión
    // sería un N+1 sobre una tabla que solo crece.
    const { data: revertidas, error: errorRevert } = await this.db
      .from("admin_actions")
      .select("payload")
      .eq("action", "lead.merge.revert");
    if (errorRevert) throw mapPostgrestError(errorRevert, { resource: "admin_actions" });

    const yaRevertidas = new Set(
      ((revertidas ?? []) as { payload: { merge_action_id?: string } | null }[])
        .map((r) => r.payload?.merge_action_id)
        .filter((id): id is string => typeof id === "string"),
    );

    return filas
      .filter((f) => f.payload?.perdedor !== undefined)
      .map((f) => ({
        accionId: f.id,
        fecha: new Date(f.created_at),
        perdedor: leadDelPayload(f.payload?.perdedor),
        reversible: (f.payload?.payload_version ?? 1) >= 2,
        revertida: yaRevertidas.has(f.id),
      }));
  }

  async revert(accionId: UUID): Promise<{ perdedorId: UUID }> {
    const { data, error } = await this.db.rpc("revert_lead_merge", {
      p_merge_action_id: accionId,
    });
    if (error) throw mapPostgrestError(error, { resource: "lead_merge" });

    const row = (data as RevertLeadMergeRow[] | null)?.[0];
    if (!row) throw new InfraError("revert_lead_merge no devolvió resultado", "postgrest");
    if (row.error_code !== null) this.throwRevertError(row.error_code, accionId);
    if (row.perdedor_id === null) {
      throw new InfraError("revert_lead_merge devolvió perdedor nulo", "postgrest");
    }
    return { perdedorId: row.perdedor_id };
  }

  private throwRevertError(code: RevertErrorCode, accionId: UUID): never {
    switch (code) {
      case "action_not_found":
        throw new NotFoundError(`fusión no encontrada: ${accionId}`, "admin_action", accionId);
      case "not_a_merge":
        throw new ValidationError("Esa acción no es una fusión de leads.");
      case "payload_too_old":
        throw new ValidationError(
          "Esta fusión es anterior al registro reversible: no quedó guardado qué conversaciones y sesiones se movieron.",
        );
      case "already_reverted":
        throw new ConflictError(`fusión ya revertida: ${accionId}`, "already_reverted");
      case "ganador_not_found":
        throw new NotFoundError("el lead que absorbió ya no existe", "lead", accionId);
      case "lead_exists":
        throw new ConflictError("el lead ya fue restaurado", "lead_exists");
      case "telefono_taken":
        throw new ConflictError(
          "otro lead está usando el teléfono del que se quiere restaurar",
          "telefono_taken",
        );
      case "sesiones_activas_duplicadas":
        throw new ValidationError(
          "Deshacer dejaría dos conversaciones abiertas en el mismo lead. Cerrá una desde el inbox y reintentá.",
        );
    }
  }

  private throwDomainError(code: MergeErrorCode, input: ApproveLeadMergeInput): never {
    switch (code) {
      case "candidate_not_found":
        throw new NotFoundError(
          `merge_candidate no encontrado: ${input.candidateId}`,
          "merge_candidate",
          input.candidateId,
        );
      case "candidate_resolved":
        throw new ConflictError(
          `merge_candidate ya resuelto: ${input.candidateId}`,
          "already_resolved",
        );
      case "invalid_keep":
        throw new ValidationError("Datos inválidos. Refrescá la página.");
      case "both_active":
        throw new ValidationError(
          "Ambos leads tienen sesión activa — cerrá una desde el inbox antes de fusionar.",
        );
      case "lead_not_found":
        throw new NotFoundError("lead del par no encontrado", "lead", input.keepLeadId);
    }
  }
}
