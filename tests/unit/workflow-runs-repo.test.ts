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
