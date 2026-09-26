import { describe, expect, it, vi } from "vitest";
import { dispararHandler } from "@/inngest/functions/workflow-disparar";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { DefaultCorridasWorkflowService } from "@/server/services/workflows/corridas.service";
import type { Grafo } from "@/types/workflows";

/**
 * La política "reiniciar" cancela en la base la corrida viva del lead. Sin
 * `workflow/corrida.cancelada`, el segmento de esa corrida que duerme en
 * Inngest (una espera) sigue dormido hasta vencer: la cancelación tiene que
 * avisarse, igual que "Cancelar corrida" a mano.
 */

const GRAFO: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
    { id: "fin", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 1 } },
  ],
  aristas: [{ desde: "t", hasta: "fin", puerto: "salida" }],
};

function repoReiniciar() {
  return new InMemoryWorkflowRunsRepository(
    () => "w1",
    () => ({ maxPasos: 50, politica: "reiniciar" }),
  );
}

const ARRANQUE = { versionId: "v1", leadId: "l1", sessionId: null, contexto: {} };

describe("reiniciar: qué corridas canceló", () => {
  it("arrancar devuelve las corridas vivas que la política canceló", async () => {
    const runs = repoReiniciar();
    const primera = await runs.arrancar(ARRANQUE);
    const segunda = await runs.arrancar(ARRANQUE);
    expect(segunda.run).not.toBeNull();
    expect(segunda.cancelados).toEqual([primera.run!.id]);
    expect((await runs.findRun(primera.run!.id))?.estado).toBe("cancelado");
  });

  it("sin corrida viva no cancela nada", async () => {
    const r = await repoReiniciar().arrancar(ARRANQUE);
    expect(r.cancelados).toEqual([]);
  });
});

describe("el disparo avisa a Inngest de cada corrida que reinició", () => {
  it("emite workflow/corrida.cancelada por cada una, además del segmento de la nueva", async () => {
    const runs = repoReiniciar();
    const vieja = await runs.arrancar(ARRANQUE);
    const emitir = vi.fn(async () => {});
    const emitirCancelacion = vi.fn(async () => {});
    const r = await dispararHandler(
      { disparador: "manual", workflowId: "w1", leadId: "l1", contexto: {} },
      {
        runs,
        workflows: {
          listarPublicadasPorDisparador: async () => [
            {
              id: "v1",
              workflow_id: "w1",
              version: 1,
              grafo: GRAFO,
              max_pasos: 50,
              publicada: true,
            } as never,
          ],
        },
        emitir,
        emitirCancelacion,
      },
    );
    expect(r.arrancadas).toBe(1);
    expect(emitirCancelacion).toHaveBeenCalledWith(vieja.run!.id);
    expect(emitir).toHaveBeenCalledTimes(1);
  });
});

describe("«Ejecutar de nuevo» también avisa lo que reinició", () => {
  it("relanzar una fallada con otra viva y política reiniciar emite la cancelación", async () => {
    const runs = repoReiniciar();
    const fallada = await runs.arrancar(ARRANQUE);
    await runs.fallar(fallada.run!.id, "boom", 1);
    const viva = await runs.arrancar(ARRANQUE);
    const cancelaciones: string[] = [];
    const service = new DefaultCorridasWorkflowService({
      workflows: { findVersion: async () => null, findWorkflow: async () => null },
      runs,
      leads: { findById: async () => null },
      vehiculos: { listByLeadId: async () => [] },
      messages: { findById: async () => null, findByIdempotencyKey: async () => null },
      emitirSegmento: async () => {},
      emitirCancelacion: async (runId) => {
        cancelaciones.push(runId);
      },
      audit: { recordAction: async () => ({}) as never },
    });
    await service.ejecutarDeNuevo(fallada.run!.id);
    expect(cancelaciones).toEqual([viva.run!.id]);
  });
});
