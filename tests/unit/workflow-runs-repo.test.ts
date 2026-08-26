import { describe, expect, it } from "vitest";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { runWorkflowRunsContract } from "../repositories/workflow-runs.contract";

runWorkflowRunsContract(async () => ({
  repo: new InMemoryWorkflowRunsRepository(),
  versionId: "version-1",
  leadId: "lead-1",
}));

describe("InMemoryWorkflowRunsRepository — escopeo de 'corrida viva' por workflow", () => {
  it("con lookup versionId->workflowId, dos workflows distintos corren en paralelo para el mismo lead", async () => {
    // Mismo escopeo que arrancar_workflow_run en Postgres: el join filtra por
    // workflow_id de la versión que dispara, no por lead a secas.
    const workflowDeVersion = new Map([
      ["version-a1", "workflow-a"],
      ["version-b1", "workflow-b"],
    ]);
    const repo = new InMemoryWorkflowRunsRepository((versionId) =>
      workflowDeVersion.get(versionId),
    );

    const primera = await repo.arrancar({
      versionId: "version-a1",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    expect(primera.run).not.toBeNull();

    const segunda = await repo.arrancar({
      versionId: "version-b1",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    expect(segunda.run).not.toBeNull();
    expect(segunda.motivo).toBeUndefined();
  });

  it("sin lookup, sigue bloqueando cualquier corrida viva del lead (fallback histórico)", async () => {
    const repo = new InMemoryWorkflowRunsRepository();
    await repo.arrancar({
      versionId: "version-a1",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    const segunda = await repo.arrancar({
      versionId: "version-b1",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    expect(segunda.run).toBeNull();
    expect(segunda.motivo).toBe("ya_hay_corrida_viva");
  });

  it("con lookup, un segundo disparo del mismo workflow sigue bloqueado", async () => {
    const workflowDeVersion = new Map([
      ["version-a1", "workflow-a"],
      ["version-a2", "workflow-a"],
    ]);
    const repo = new InMemoryWorkflowRunsRepository((versionId) =>
      workflowDeVersion.get(versionId),
    );

    await repo.arrancar({
      versionId: "version-a1",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    const segunda = await repo.arrancar({
      versionId: "version-a2",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    expect(segunda.run).toBeNull();
    expect(segunda.motivo).toBe("ya_hay_corrida_viva");
  });
});

describe("InMemoryWorkflowRunsRepository.metricasPorWorkflow", () => {
  const DESDE = new Date("2020-01-01T00:00:00Z");

  it("cuenta total y exitosos, y agarra el último run por started_at", async () => {
    const workflowDeVersion = new Map([["v1", "workflow-a"]]);
    const repo = new InMemoryWorkflowRunsRepository((versionId) =>
      workflowDeVersion.get(versionId),
    );

    const { run: r1 } = await repo.arrancar({
      versionId: "v1",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    await repo.terminar(r1!.id, 3);

    const { run: r2 } = await repo.arrancar({
      versionId: "v1",
      leadId: "lead-2",
      sessionId: null,
      contexto: {},
    });
    await repo.fallar(r2!.id, "boom", 1);

    const metricas = await repo.metricasPorWorkflow(["workflow-a"], DESDE);

    expect(metricas["workflow-a"]).toEqual({
      totalRuns: 2,
      runsExitosos: 1,
      ultimoRun: expect.objectContaining({ exito: false }),
    });
  });

  it("un workflow que no aparece entre los ids buscados queda afuera del resultado", async () => {
    const workflowDeVersion = new Map([["v1", "workflow-a"]]);
    const repo = new InMemoryWorkflowRunsRepository((versionId) =>
      workflowDeVersion.get(versionId),
    );
    const { run } = await repo.arrancar({
      versionId: "v1",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    await repo.terminar(run!.id, 1);

    expect(await repo.metricasPorWorkflow(["workflow-b"], DESDE)).toEqual({});
  });

  it("una corrida anterior a 'desde' no se cuenta", async () => {
    const workflowDeVersion = new Map([["v1", "workflow-a"]]);
    const repo = new InMemoryWorkflowRunsRepository((versionId) =>
      workflowDeVersion.get(versionId),
    );
    const { run } = await repo.arrancar({
      versionId: "v1",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    await repo.terminar(run!.id, 1);

    const futuro = new Date(Date.now() + 60_000);
    expect(await repo.metricasPorWorkflow(["workflow-a"], futuro)).toEqual({});
  });

  it("una corrida todavía viva cuenta para el total pero no para exitosos", async () => {
    const workflowDeVersion = new Map([["v1", "workflow-a"]]);
    const repo = new InMemoryWorkflowRunsRepository((versionId) =>
      workflowDeVersion.get(versionId),
    );
    await repo.arrancar({ versionId: "v1", leadId: "lead-1", sessionId: null, contexto: {} });

    const metricas = await repo.metricasPorWorkflow(["workflow-a"], DESDE);

    expect(metricas["workflow-a"]?.totalRuns).toBe(1);
    expect(metricas["workflow-a"]?.runsExitosos).toBe(0);
    expect(metricas["workflow-a"]?.ultimoRun?.exito).toBe(false);
  });
});
