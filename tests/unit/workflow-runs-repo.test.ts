import { describe, expect, it } from "vitest";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { MARCA_CORRIDA_DE_PRUEBA } from "@/types/workflows";
import { runWorkflowRunsContract } from "../repositories/workflow-runs.contract";

runWorkflowRunsContract(async () => ({
  repo: new InMemoryWorkflowRunsRepository((versionId) =>
    versionId === "version-1" ? "workflow-1" : undefined,
  ),
  versionId: "version-1",
  leadId: "lead-1",
  workflowId: "workflow-1",
}));

describe("InMemoryWorkflowRunsRepository.reanudar — lo que en Postgres sale de la versión", () => {
  async function falladaEn(repo: InMemoryWorkflowRunsRepository, orden: number) {
    const { run } = await repo.arrancar({
      versionId: "v1",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    await repo.registrarPaso(run!.id, {
      nodo_id: "m",
      orden,
      entrada: null,
      salida: null,
      error: "boom",
    });
    await repo.fallar(run!.id, "boom", orden);
    return run!;
  }

  it("un paso fallado en el tope de la versión no se reanuda: volvería a cortarse", async () => {
    const repo = new InMemoryWorkflowRunsRepository(
      () => "workflow-a",
      () => ({ maxPasos: 3, politica: "ignorar" }),
    );
    const run = await falladaEn(repo, 3);
    expect(await repo.reanudar(run.id)).toEqual({ ok: false, motivo: "tope_pasos" });
  });

  it("un paso fallado antes del tope se reanuda", async () => {
    const repo = new InMemoryWorkflowRunsRepository(
      () => "workflow-a",
      () => ({ maxPasos: 3, politica: "ignorar" }),
    );
    const run = await falladaEn(repo, 2);
    expect(await repo.reanudar(run.id)).toEqual({ ok: true, desdePaso: 2, nodoId: "m" });
  });

  it("con política 'permitir', otra corrida viva del mismo lead no la frena", async () => {
    const repo = new InMemoryWorkflowRunsRepository(
      () => "workflow-a",
      () => ({ maxPasos: 500, politica: "permitir" }),
    );
    const run = await falladaEn(repo, 2);
    // Con `permitir`, `arrancar` también deja una segunda viva.
    await repo.arrancar({ versionId: "v1", leadId: "lead-1", sessionId: null, contexto: {} });
    expect(await repo.reanudar(run.id)).toMatchObject({ ok: true });
  });
});

describe("InMemoryWorkflowRunsRepository — Probar y la política 'reiniciar'", () => {
  const prueba = { [MARCA_CORRIDA_DE_PRUEBA]: true };
  const conReiniciar = () =>
    new InMemoryWorkflowRunsRepository(
      () => "workflow-a",
      () => ({ maxPasos: 500, politica: "reiniciar" }),
    );

  it("probar un flujo 'reiniciar' no cancela la corrida de producción viva del lead", async () => {
    const repo = conReiniciar();
    const { run: produccion } = await repo.arrancar({
      versionId: "v1",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    const probada = await repo.arrancar({
      versionId: "v1",
      leadId: "lead-1",
      sessionId: null,
      contexto: prueba,
    });
    expect(probada.run).not.toBeNull();
    const despues = await repo.findRun(produccion!.id);
    expect(despues?.estado).toBe("corriendo");
    expect(despues?.ended_at).toBeNull();
  });

  it("un disparo de producción 'reiniciar' cancela sólo corridas de producción", async () => {
    const repo = conReiniciar();
    const base = { versionId: "v1", leadId: "lead-1", sessionId: null };
    const { run: probada } = await repo.arrancar({ ...base, contexto: prueba });
    const { run: vieja } = await repo.arrancar({ ...base, contexto: {} });
    await repo.arrancar({ ...base, contexto: {} });
    expect((await repo.findRun(vieja!.id))?.estado).toBe("cancelado");
    expect((await repo.findRun(probada!.id))?.estado).toBe("corriendo");
  });

  it("una corrida de Probar viva no frena reanudar una de producción", async () => {
    const repo = new InMemoryWorkflowRunsRepository(
      () => "workflow-a",
      () => ({ maxPasos: 500, politica: "ignorar" }),
    );
    const { run } = await repo.arrancar({
      versionId: "v1",
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    await repo.registrarPaso(run!.id, {
      nodo_id: "m",
      orden: 2,
      entrada: null,
      salida: null,
      error: "boom",
    });
    await repo.fallar(run!.id, "boom", 2);
    await repo.arrancar({ versionId: "v1", leadId: "lead-1", sessionId: null, contexto: prueba });
    expect(await repo.reanudar(run!.id)).toMatchObject({ ok: true });
  });
});

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
