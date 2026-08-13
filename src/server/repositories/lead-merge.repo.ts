import type { UUID } from "@/types/entities";

export interface ApproveLeadMergeInput {
  candidateId: UUID;
  keepLeadId: UUID;
}

/** Puerto atómico para aprobar un merge de leads. */
export interface LeadMergeRepository {
  approve(input: ApproveLeadMergeInput): Promise<{ ganadorId: UUID }>;
}
