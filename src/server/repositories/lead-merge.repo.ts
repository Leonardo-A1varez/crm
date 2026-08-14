import type { UUID } from "@/types/entities";
import type { FusionRegistrada } from "@/types/leads";

export interface ApproveLeadMergeInput {
  candidateId: UUID;
  keepLeadId: UUID;
}

export type { FusionRegistrada };

/** Puerto atómico para aprobar y deshacer un merge de leads. */
export interface LeadMergeRepository {
  approve(input: ApproveLeadMergeInput): Promise<{ ganadorId: UUID }>;
  /** Las fusiones que absorbieron leads dentro de este, de la más nueva a la más vieja. */
  listByLeadId(leadId: UUID): Promise<FusionRegistrada[]>;
  /** Deshace la fusión registrada. Devuelve el lead resucitado. */
  revert(accionId: UUID): Promise<{ perdedorId: UUID }>;
}
