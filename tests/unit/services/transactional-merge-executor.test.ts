import { describe, expect, test, vi } from "vitest";
import type { LeadMergeRepository } from "@/server/repositories/lead-merge.repo";
import {
  TransactionalMergeExecutorService,
  type MergeExecutorService,
} from "@/server/services/leads/merge-executor.service";

describe("TransactionalMergeExecutorService", () => {
  test("approveMerge usa el repository atómico y no el executor legado", async () => {
    const candidateId = crypto.randomUUID();
    const keepLeadId = crypto.randomUUID();
    const approval: LeadMergeRepository = {
      approve: vi.fn().mockResolvedValue({ ganadorId: keepLeadId }),
    };
    const delegate: MergeExecutorService = {
      approveMerge: vi.fn(),
      rejectMerge: vi.fn(),
      createManualCandidate: vi.fn(),
    };
    const service = new TransactionalMergeExecutorService(approval, delegate);

    await expect(
      service.approveMerge({ candidateId, keepLeadId, actorUserId: crypto.randomUUID() }),
    ).resolves.toEqual({ ganadorId: keepLeadId });

    expect(approval.approve).toHaveBeenCalledWith({ candidateId, keepLeadId });
    expect(delegate.approveMerge).not.toHaveBeenCalled();
  });

  test("las operaciones no transaccionales conservan el executor existente", async () => {
    const candidateId = crypto.randomUUID();
    const approval: LeadMergeRepository = { approve: vi.fn() };
    const delegate: MergeExecutorService = {
      approveMerge: vi.fn(),
      rejectMerge: vi.fn().mockResolvedValue(undefined),
      createManualCandidate: vi.fn(),
    };
    const service = new TransactionalMergeExecutorService(approval, delegate);

    await service.rejectMerge({ candidateId, actorUserId: null });

    expect(delegate.rejectMerge).toHaveBeenCalledWith({ candidateId, actorUserId: null });
    expect(approval.approve).not.toHaveBeenCalled();
  });
});
