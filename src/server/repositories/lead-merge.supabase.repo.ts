import { ConflictError, InfraError, NotFoundError, ValidationError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { UUID } from "@/types/entities";
import type { ApproveLeadMergeInput, LeadMergeRepository } from "./lead-merge.repo";

type MergeErrorCode =
  | "candidate_not_found"
  | "candidate_resolved"
  | "invalid_keep"
  | "both_active"
  | "lead_not_found";

interface ApproveLeadMergeRow {
  ganador_id: string | null;
  error_code: MergeErrorCode | null;
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
