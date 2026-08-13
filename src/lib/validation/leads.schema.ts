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

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable(),
  );

const nullableEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase())
    .nullable(),
);

const nullableYear = z.preprocess(
  (value) => (value === "" || value === null ? null : Number(value)),
  z
    .number()
    .int()
    .min(1886)
    .max(new Date().getUTCFullYear() + 1)
    .nullable(),
);

export const UpdateLeadProfileSchema = z.preprocess(
  (raw) => (raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw),
  z.object({
    leadId: UUIDSchema,
    nombre: z.string().trim().min(1).max(120),
    email: nullableEmail,
    direccion: nullableText(300),
    vehiculoMarca: nullableText(100),
    vehiculoModelo: nullableText(100),
    vehiculoAnio: nullableYear,
    vehiculoMotor: nullableText(100),
  }),
);
export type UpdateLeadProfileInput = z.infer<typeof UpdateLeadProfileSchema>;
