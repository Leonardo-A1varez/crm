import { describe, expect, it } from "vitest";
import { IllegalStateError, InfraError, NotFoundError, ValidationError } from "@/lib/errors";
import { workflowCorridaCancelada } from "@/inngest/events";
import {
  makeWorkflowSegmentoFn,
  segmentoFalloHandler,
  segmentoHandler,
} from "@/inngest/functions/workflow-segmento";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import type { RecordActionInput } from "@/server/services/admin-audit.service";
import { DefaultCorridasWorkflowService } from "@/server/services/workflows/corridas.service";
import type { Grafo } from "@/types/workflows";

// Fixtures armados a mano para estos tests: no salen de ningún dato real.
// trigger -> etiqueta -> etapa -> esperar 1 h -> fin
const GRAFO: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
    { id: "a1", tipo: "crm_etiqueta_add", config: {}, posicion: { x: 0, y: 1 } },
    { id: "a2", tipo: "crm_etapa", config: {}, posicion: { x: 0, y: 2 } },
    {
      id: "e",
      tipo: "logica_esperar",
      config: { duracion: 1, unidad: "horas" },
      posicion: { x: 0, y: 3 },
    },
    { id: "fin", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 4 } },
  ],
  aristas: [
    { desde: "t", hasta: "a1", puerto: "salida" },
    { desde: "a1", hasta: "a2", puerto: "salida" },
    { desde: "a2", hasta: "e", puerto: "salida" },
    { desde: "e", hasta: "fin", puerto: "salida" },
  ],
};

const VERSION = {
  id: "v1",
  workflow_id: "w1",
  version: 1,
  grafo: GRAFO,
  max_pasos: 50,
  publicada: true,
};

async function montar(alEjecutar?: (nodoId: string) => Promise<void>) {
  const runs = new InMemoryWorkflowRunsRepository();
  const ejecutadas: string[] = [];
  const handler = async (nodo: { id: string }) => {
    ejecutadas.push(nodo.id);
    await alEjecutar?.(nodo.id);
    return { puerto: "salida" as const };
  };
  const { run } = await runs.arrancar({
    versionId: "v1",
    leadId: "l1",
    sessionId: null,
    contexto: {},
  });
  const deps = {
    runs,
    workflows: { findVersion: async () => VERSION as never },
    registro: crearRegistro({ poner_etiqueta: handler, cambiar_etapa: handler }),
    ahora: () => new Date("2026-09-25T12:00:00Z"),
  };
  return { runs, runId: run!.id, deps, ejecutadas };
}

describe("cancelar una corrida mientras su segmento corre", () => {
  it("la acción siguiente no se ejecuta y el segmento no la resucita", async () => {
    let runId = "";
    let repo: InMemoryWorkflowRunsRepository | null = null;
    const m = await montar(async (nodoId) => {
      // Alguien aprieta "Cancelar corrida" justo después de la primera acción.
      if (nodoId === "a1") await repo!.cancelarSiViva(runId, "cancelada a mano");
    });
    runId = m.runId;
    repo = m.runs;

    const r = await segmentoHandler({ runId, desdePaso: 0 }, m.deps);

    expect(r).toEqual({ tipo: "cancelada", nodoId: "a2" });
    expect(m.ejecutadas).toEqual(["a1"]);
    expect(await m.runs.findRun(runId)).toMatchObject({
      estado: "cancelado",
      error: "cancelada a mano",
    });
  });

  it("una corrida que esperaba y la cancelaron: al despertar, el segmento no hace nada", async () => {
    const m = await montar();
    const primero = await segmentoHandler({ runId: m.runId, desdePaso: 0 }, m.deps);
    expect(primero.tipo).toBe("espera");
    await m.runs.cancelarSiViva(m.runId, "cancelada a mano");

    const desdePaso = primero.tipo === "espera" ? primero.desdePaso : -1;
    const alDespertar = await segmentoHandler({ runId: m.runId, desdePaso }, m.deps);

    expect(alDespertar).toEqual({ tipo: "no-op" });
    expect(m.ejecutadas).toEqual(["a1", "a2"]);
    expect((await m.runs.findRun(m.runId))?.estado).toBe("cancelado");
  });
});

describe("CorridasWorkflowService.cancelar", () => {
  const ADMIN = "00000000-0000-4000-8000-0000000000ad";
  let auditadas: RecordActionInput[] = [];
  let avisadas: string[] = [];
  let avisar: (runId: string) => Promise<void> = async () => {};

  function servicio(runs: InMemoryWorkflowRunsRepository) {
    auditadas = [];
    avisadas = [];
    avisar = async (runId) => {
      avisadas.push(runId);
    };
    return new DefaultCorridasWorkflowService({
      workflows: { findVersion: async () => null, findWorkflow: async () => null },
      runs,
      leads: { findById: async () => null },
      vehiculos: { listByLeadId: async () => [] },
      messages: { findById: async () => null, findByIdempotencyKey: async () => null },
      emitirSegmento: async () => {},
      emitirCancelacion: (runId) => avisar(runId),
      audit: {
        recordAction: async (input) => {
          auditadas.push(input);
          return {} as never;
        },
      },
    });
  }

  it("avisa a Inngest para cortar ya la espera, y audita quién canceló sin datos del lead", async () => {
    const runs = new InMemoryWorkflowRunsRepository();
    const { run } = await runs.arrancar({
      versionId: "v1",
      leadId: "l1",
      sessionId: null,
      contexto: { lead: { nombre: "Ana" } },
    });
    await servicio(runs).cancelar(run!.id, ADMIN);

    expect(avisadas).toEqual([run!.id]);
    expect(auditadas).toEqual([
      {
        actorUserId: ADMIN,
        action: "workflow_run.cancel",
        entityType: "workflow_run",
        entityId: run!.id,
        payload: { version_id: "v1", estado_previo: "corriendo", prueba: false },
      },
    ]);
    // Ni el lead, ni su nombre, ni nada del contexto.
    expect(JSON.stringify(auditadas)).not.toMatch(/l1|Ana/);
  });

  it("una que ya cerró no se audita ni se avisa", async () => {
    const runs = new InMemoryWorkflowRunsRepository();
    const { run } = await runs.arrancar({
      versionId: "v1",
      leadId: "l1",
      sessionId: null,
      contexto: {},
    });
    await runs.terminar(run!.id, 1);
    const svc = servicio(runs);
    await expect(svc.cancelar(run!.id, ADMIN)).rejects.toBeInstanceOf(IllegalStateError);
    expect(auditadas).toEqual([]);
    expect(avisadas).toEqual([]);
  });

  it("si Inngest no se entera, la corrida queda cancelada y auditada, y se dice", async () => {
    const runs = new InMemoryWorkflowRunsRepository();
    const { run } = await runs.arrancar({
      versionId: "v1",
      leadId: "l1",
      sessionId: null,
      contexto: {},
    });
    const svc = servicio(runs);
    avisar = async () => {
      throw new Error("inngest caído");
    };
    await expect(svc.cancelar(run!.id, ADMIN)).rejects.toBeInstanceOf(InfraError);
    expect((await runs.findRun(run!.id))?.estado).toBe("cancelado");
    expect(auditadas).toHaveLength(1);
  });

  it("cancela una corrida viva, también una de Probar, con el motivo", async () => {
    const runs = new InMemoryWorkflowRunsRepository();
    const { run } = await runs.arrancar({
      versionId: "v1",
      leadId: "l1",
      sessionId: null,
      contexto: { $prueba: true },
    });
    await servicio(runs).cancelar(run!.id, ADMIN);
    expect(await runs.findRun(run!.id)).toMatchObject({
      estado: "cancelado",
      error: "Cancelada a mano desde el panel.",
    });
  });

  it("una que ya cerró es IllegalStateError y una que no existe NotFoundError", async () => {
    const runs = new InMemoryWorkflowRunsRepository();
    const { run } = await runs.arrancar({
      versionId: "v1",
      leadId: "l1",
      sessionId: null,
      contexto: {},
    });
    await runs.terminar(run!.id, 1);
    await expect(servicio(runs).cancelar(run!.id, ADMIN)).rejects.toBeInstanceOf(IllegalStateError);
    await expect(servicio(runs).cancelar("no-existe", ADMIN)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("los intentos de la corrida que falla", () => {
  it("una falla definitiva anota en qué intento de Inngest ocurrió", async () => {
    const m = await montar(async (nodoId) => {
      if (nodoId === "a1") throw new ValidationError("no se puede");
    });
    await segmentoHandler({ runId: m.runId, desdePaso: 0, intento: 2 }, m.deps);
    expect(await m.runs.findRun(m.runId)).toMatchObject({ estado: "fallado", intentos: 2 });
  });

  it("agotar los reintentos anota todos los intentos", async () => {
    const m = await montar();
    await segmentoFalloHandler(
      { runId: m.runId, desdePaso: 0, mensaje: "timeout", intentos: 4 },
      { runs: m.runs },
    );
    expect(await m.runs.findRun(m.runId)).toMatchObject({ estado: "fallado", intentos: 4 });
  });
});

describe("workflow-segmento se corta con el evento de cancelación", () => {
  it("declara cancelOn con workflow/corrida.cancelada de la misma corrida", () => {
    const fn = makeWorkflowSegmentoFn({
      runs: {} as never,
      workflows: {} as never,
      registro: crearRegistro({}),
    });
    // `opts` es la config con que se registró la función (InngestFunction.opts
    // en inngest 4.4.0): con ella Inngest corta una corrida dormida en
    // `step.waitForEvent`/`step.sleepUntil`.
    const opts = (fn as unknown as { opts: { cancelOn?: unknown[] } }).opts;
    expect(opts.cancelOn).toEqual([{ event: workflowCorridaCancelada, match: "data.runId" }]);
  });
});
