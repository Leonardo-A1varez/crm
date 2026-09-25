import { describe, expect, test, vi } from "vitest";
import { InfraError } from "@/lib/errors";
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

function filaDeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    workflow_version_id: crypto.randomUUID(),
    lead_id: crypto.randomUUID(),
    lead_session_id: null,
    estado: "corriendo",
    nodo_actual: null,
    contexto: {},
    pasos_ejecutados: 0,
    error: null,
    started_at: "2026-09-13T12:00:00Z",
    ended_at: null,
    ...overrides,
  };
}

describe("SupabaseWorkflowRunsRepository.reanudar", () => {
  test("invoca la RPC y devuelve desde qué paso y qué nodo sigue", async () => {
    const runId = crypto.randomUUID();
    const rpc = vi.fn().mockResolvedValue({
      data: [{ desde_paso: 2, nodo_id: "m", error_code: null }],
      error: null,
    });
    const repo = new SupabaseWorkflowRunsRepository({ rpc } as unknown as AppClient);

    expect(await repo.reanudar(runId)).toEqual({ ok: true, desdePaso: 2, nodoId: "m" });
    expect(rpc).toHaveBeenCalledWith("reanudar_workflow_run", { p_run_id: runId });
  });

  test("un motivo de la RPC vuelve como motivo, no como excepción", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ desde_paso: null, nodo_id: null, error_code: "tope_pasos" }],
      error: null,
    });
    const repo = new SupabaseWorkflowRunsRepository({ rpc } as unknown as AppClient);

    expect(await repo.reanudar(crypto.randomUUID())).toEqual({ ok: false, motivo: "tope_pasos" });
  });

  test("una respuesta vacía de la RPC es un fallo de infraestructura", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const repo = new SupabaseWorkflowRunsRepository({ rpc } as unknown as AppClient);

    await expect(repo.reanudar(crypto.randomUUID())).rejects.toBeInstanceOf(InfraError);
  });
});

describe("SupabaseWorkflowRunsRepository.relanzar", () => {
  test("invoca la RPC y relee la corrida nueva", async () => {
    const fila = filaDeRun();
    const rpc = vi.fn().mockResolvedValue({
      data: [{ run_id: fila.id, error_code: null }],
      error: null,
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: fila, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });
    const repo = new SupabaseWorkflowRunsRepository({ rpc, from } as unknown as AppClient);

    const { run, motivo } = await repo.relanzar("run-fallada");

    expect(rpc).toHaveBeenCalledWith("relanzar_workflow_run", { p_run_id: "run-fallada" });
    expect(eq).toHaveBeenCalledWith("id", fila.id);
    expect(motivo).toBeUndefined();
    expect(run?.id).toBe(fila.id);
  });

  test("un motivo de la RPC vuelve como motivo, sin corrida", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ run_id: null, error_code: "ya_hay_corrida_viva" }],
      error: null,
    });
    const repo = new SupabaseWorkflowRunsRepository({ rpc } as unknown as AppClient);

    expect(await repo.relanzar("run-fallada")).toEqual({
      run: null,
      motivo: "ya_hay_corrida_viva",
    });
  });
});

describe("SupabaseWorkflowRunsRepository.contarVivasPorVersion", () => {
  test("invoca la RPC agregada y mapea las filas", async () => {
    const workflowId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const rpc = vi.fn().mockResolvedValue({
      data: [{ version_id: versionId, cantidad: 3 }],
      error: null,
    });
    const repo = new SupabaseWorkflowRunsRepository({ rpc } as unknown as AppClient);

    expect(await repo.contarVivasPorVersion(workflowId)).toEqual([{ versionId, cantidad: 3 }]);
    expect(rpc).toHaveBeenCalledWith("contar_corridas_vivas", { p_workflow_id: workflowId });
  });
});

describe("SupabaseWorkflowRunsRepository.contarSaltosPorMotivo", () => {
  test("cuenta en la base (RPC) y completa en 0 los motivos que no saltaron", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { motivo: "tope_frecuencia", cantidad: 4 },
        // `bigint` puede llegar como texto: se normaliza.
        { motivo: "dado_de_baja", cantidad: "2" },
      ],
      error: null,
    });
    const repo = new SupabaseWorkflowRunsRepository({ rpc } as unknown as AppClient);

    expect(await repo.contarSaltosPorMotivo(DESDE)).toEqual({
      tope_frecuencia: 4,
      dado_de_baja: 2,
      sin_ventana: 0,
      conversacion_activa: 0,
      requiere_humano: 0,
    });
    expect(rpc).toHaveBeenCalledWith("contar_saltos_workflow", { p_desde: DESDE.toISOString() });
  });

  test("un motivo que la app no conoce es un contrato roto: falla en voz alta", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ motivo: "otro", cantidad: 1 }],
      error: null,
    });
    const repo = new SupabaseWorkflowRunsRepository({ rpc } as unknown as AppClient);
    await expect(repo.contarSaltosPorMotivo(DESDE)).rejects.toBeInstanceOf(InfraError);
  });
});
