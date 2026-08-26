import { describe, expect, test, vi } from "vitest";
import type { AppClient } from "@/server/db/client";
import { SupabaseWorkflowRunsRepository } from "@/server/repositories/workflow-runs.supabase.repo";

const DESDE = new Date("2020-01-01T00:00:00Z");

describe("SupabaseWorkflowRunsRepository.metricasPorWorkflow", () => {
  test("sin ids, no golpea la base y devuelve vacío", async () => {
    const from = vi.fn();
    const fake = { from } as unknown as AppClient;
    const repo = new SupabaseWorkflowRunsRepository(fake);

    expect(await repo.metricasPorWorkflow([], DESDE)).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  test("agrega por workflow_id embebido y calcula total/exitosos/último", async () => {
    const workflowId = crypto.randomUUID();
    const filas = [
      {
        estado: "terminado",
        error: null,
        started_at: "2024-01-01T00:00:00Z",
        ended_at: "2024-01-01T00:00:05Z",
        workflow_versiones: { workflow_id: workflowId },
      },
      {
        estado: "fallado",
        error: "boom",
        started_at: "2024-01-02T00:00:00Z",
        ended_at: "2024-01-02T00:00:01Z",
        workflow_versiones: { workflow_id: workflowId },
      },
    ];
    const range = vi.fn().mockResolvedValue({ data: filas, error: null });
    const gte = vi.fn().mockReturnValue({ range });
    const inFn = vi.fn().mockReturnValue({ gte });
    const select = vi.fn().mockReturnValue({ in: inFn });
    const from = vi.fn().mockReturnValue({ select });
    const fake = { from } as unknown as AppClient;
    const repo = new SupabaseWorkflowRunsRepository(fake);

    const metricas = await repo.metricasPorWorkflow([workflowId], DESDE);

    expect(from).toHaveBeenCalledWith("workflow_runs");
    expect(inFn).toHaveBeenCalledWith("workflow_versiones.workflow_id", [workflowId]);
    expect(gte).toHaveBeenCalledWith("started_at", DESDE.toISOString());
    expect(metricas[workflowId]).toEqual({
      totalRuns: 2,
      runsExitosos: 1,
      // El más reciente por started_at es el fallado (2024-01-02), no el
      // terminado (2024-01-01) -- confirma que ordena por fecha y no por
      // orden de llegada de las filas.
      ultimoRun: { at: new Date("2024-01-02T00:00:00Z"), exito: false, duracionMs: 1000 },
    });
  });

  test("propaga el error de Postgres mapeado", async () => {
    const range = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({ gte: vi.fn().mockReturnValue({ range }) }),
      }),
    });
    const fake = { from } as unknown as AppClient;
    const repo = new SupabaseWorkflowRunsRepository(fake);

    await expect(repo.metricasPorWorkflow([crypto.randomUUID()], DESDE)).rejects.toThrow();
  });
});
