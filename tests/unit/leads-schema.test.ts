import { describe, expect, test } from "vitest";
import {
  ApproveMergeSchema,
  CreateManualCandidateSchema,
  RejectMergeSchema,
  SearchLeadsSchema,
} from "@/lib/validation/leads.schema";

const uuidA = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const uuidB = "7f9619ff-8b86-4d01-b42d-00cf4fc964ff";

describe("leads schemas", () => {
  test("ApproveMergeSchema exige 2 uuids", () => {
    expect(ApproveMergeSchema.safeParse({ candidateId: uuidA, keepLeadId: uuidB }).success).toBe(
      true,
    );
    expect(ApproveMergeSchema.safeParse({ candidateId: "x", keepLeadId: uuidB }).success).toBe(
      false,
    );
  });

  test("RejectMergeSchema exige uuid válido", () => {
    expect(RejectMergeSchema.safeParse({ candidateId: uuidA }).success).toBe(true);
    expect(RejectMergeSchema.safeParse({ candidateId: "x" }).success).toBe(false);
    expect(RejectMergeSchema.safeParse({}).success).toBe(false);
  });

  test("CreateManualCandidateSchema rechaza self-pair", () => {
    expect(
      CreateManualCandidateSchema.safeParse({ leadId: uuidA, otherLeadId: uuidA }).success,
    ).toBe(false);
    expect(
      CreateManualCandidateSchema.safeParse({ leadId: uuidA, otherLeadId: uuidB }).success,
    ).toBe(true);
  });

  test("SearchLeadsSchema exige 1-100 chars trim", () => {
    expect(SearchLeadsSchema.safeParse({ q: "  " }).success).toBe(false);
    expect(SearchLeadsSchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
    expect(SearchLeadsSchema.parse({ q: "  ana " }).q).toBe("ana");
  });
});
