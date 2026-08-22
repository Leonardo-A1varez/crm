import { describe, expect, test, vi } from "vitest";
import { InfraError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { SupabaseWorkflowsRepository } from "@/server/repositories/workflows.supabase.repo";

const COLS_VERSION =
  "id, workflow_id, version, grafo, max_pasos, publicada, created_at, created_by, politica_concurrencia";

describe("SupabaseWorkflowsRepository.publicarVersion", () => {
  test("invoca la RPC transaccional y relee la version publicada", async () => {
    const versionId = crypto.randomUUID();
    const workflowId = crypto.randomUUID();
    const filaVersion = {
      id: versionId,
      workflow_id: workflowId,
      version: 2,
      grafo: { nodos: [], aristas: [] },
      max_pasos: 500,
      publicada: true,
      created_at: new Date().toISOString(),
      created_by: null,
      politica_concurrencia: "ignorar",
    };

    const rpc = vi.fn().mockResolvedValue({
      data: [{ version_id: versionId, error_code: null }],
      error: null,
    });
    const select = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: filaVersion, error: null });
    const from = vi.fn().mockReturnValue({ select, eq, single });

    const fake = { rpc, from } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    const resultado = await repo.publicarVersion(versionId);

    expect(rpc).toHaveBeenCalledWith("publicar_workflow_version", { p_version_id: versionId });
    expect(from).toHaveBeenCalledWith("workflow_versiones");
    expect(select).toHaveBeenCalledWith(COLS_VERSION);
    expect(eq).toHaveBeenCalledWith("id", versionId);
    expect(resultado.id).toBe(versionId);
    expect(resultado.publicada).toBe(true);
  });

  test("mapea version_not_found a NotFoundError", async () => {
    const versionId = crypto.randomUUID();
    const fake = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ version_id: null, error_code: "version_not_found" }],
        error: null,
      }),
    } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    await expect(repo.publicarVersion(versionId)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("rechaza una respuesta vacia de la RPC como fallo de infraestructura", async () => {
    const fake = {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    await expect(repo.publicarVersion(crypto.randomUUID())).rejects.toBeInstanceOf(InfraError);
  });
});
