import { z } from "zod";
import { UUIDSchema } from "@/lib/validation/schemas";

// Inputs Server Actions leads (fase 10). Regla §0.9.3: parse línea 1.

export const ApproveMergeSchema = z.object({ candidateId: UUIDSchema, keepLeadId: UUIDSchema });
export type ApproveMergeFormInput = z.infer<typeof ApproveMergeSchema>;

export const RejectMergeSchema = z.object({ candidateId: UUIDSchema });
export type RejectMergeFormInput = z.infer<typeof RejectMergeSchema>;

export const CreateManualCandidateSchema = z
  .object({ leadId: UUIDSchema, otherLeadId: UUIDSchema })
  .refine((d) => d.leadId !== d.otherLeadId, {
    message: "No podés marcar un lead como duplicado de sí mismo.",
  });
export type CreateManualCandidateFormInput = z.infer<typeof CreateManualCandidateSchema>;

export const SearchLeadsSchema = z.object({ q: z.string().trim().min(1).max(100) });
export type SearchLeadsFormInput = z.infer<typeof SearchLeadsSchema>;
