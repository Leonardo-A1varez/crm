import { describe, expect, test, vi } from "vitest";
import { ConflictError, InfraError, NotFoundError, ValidationError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { SupabaseLeadMergeRepository } from "@/server/repositories/lead-merge.supabase.repo";

describe("SupabaseLeadMergeRepository", () => {
  test("invoca la RPC transaccional conservando el contexto de Supabase", async () => {
    const candidateId = crypto.randomUUID();
    const keepLeadId = crypto.randomUUID();
    const fake = {
      rest: { ready: true },
      rpc: vi.fn(function (this: { rest?: { ready: boolean } }) {
        if (!this.rest?.ready) throw new TypeError("rpc perdió el contexto del cliente");
        return Promise.resolve({
          data: [{ ganador_id: keepLeadId, error_code: null }],
          error: null,
        });
      }),
    } as unknown as AppClient;

    const repo = new SupabaseLeadMergeRepository(fake);
    await expect(repo.approve({ candidateId, keepLeadId })).resolves.toEqual({
      ganadorId: keepLeadId,
    });
    expect(fake.rpc).toHaveBeenCalledWith("approve_lead_merge", {
      p_candidate_id: candidateId,
      p_keep_lead_id: keepLeadId,
    });
  });

  test.each([
    ["candidate_not_found", NotFoundError],
    ["candidate_resolved", ConflictError],
    ["invalid_keep", ValidationError],
    ["both_active", ValidationError],
    ["lead_not_found", NotFoundError],
  ] as const)("mapea el resultado de dominio %s", async (errorCode, ErrorClass) => {
    const fake = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ ganador_id: null, error_code: errorCode }],
        error: null,
      }),
    } as unknown as AppClient;
    const repo = new SupabaseLeadMergeRepository(fake);

    await expect(
      repo.approve({ candidateId: crypto.randomUUID(), keepLeadId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(ErrorClass);
  });

  test("rechaza una respuesta vacía de la RPC como fallo de infraestructura", async () => {
    const fake = {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as AppClient;
    const repo = new SupabaseLeadMergeRepository(fake);

    await expect(
      repo.approve({ candidateId: crypto.randomUUID(), keepLeadId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(InfraError);
  });
});
