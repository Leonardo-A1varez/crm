import { describe, expect, test } from "vitest";
import { arrancarPorDisparador } from "@/inngest/functions/workflow-disparar";
import { CLAVE_RESPUESTA_DE_TURNO, MOTIVO_OTRO_INTERCEPTOR } from "@/lib/workflows/interceptar";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import type { WorkflowVersion } from "@/types/entities";
import type { Grafo } from "@/types/workflows";

/**
 * Si dos flujos "intercepta el LLM" coinciden con el mismo mensaje, contesta
 * uno solo: el que eligió el pipeline (`interceptadoPor`). El otro no arranca y
 * queda en el historial con el motivo. Los flujos que no interceptan arrancan
 * como siempre.
 */

const grafo = (interceptaLlm: boolean): Grafo => ({
  nodos: [
    { id: "t", tipo: "trigger_mensaje", config: { interceptaLlm }, posicion: { x: 0, y: 0 } },
    { id: "m", tipo: "msg_texto", config: { mensaje: "hola" }, posicion: { x: 0, y: 0 } },
    { id: "d", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
  ],
  aristas: [
    { desde: "t", hasta: "m", puerto: "salida" },
    { desde: "m", hasta: "d", puerto: "salida" },
  ],
});

const version = (workflowId: string, interceptaLlm: boolean): WorkflowVersion => ({
  id: `v-${workflowId}`,
  workflow_id: workflowId,
  version: 1,
  grafo: grafo(interceptaLlm),
  max_pasos: 50,
  publicada: true,
  created_at: new Date("2026-09-01T00:00:00Z"),
  created_by: null,
  politica_concurrencia: "ignorar",
  nota: null,
});

const LEAD = "00000000-0000-4000-8000-000000000001";

describe("workflow-disparar — un solo interceptor contesta", () => {
  test("arranca el elegido y los que no interceptan; el otro interceptor queda sin arrancar", async () => {
    const runs = new InMemoryWorkflowRunsRepository((v) => v.replace(/^v-/, ""));
    const arranque = await arrancarPorDisparador(
      {
        disparador: "mensaje_recibido",
        leadId: LEAD,
        contexto: {},
        datos: { canal: "wa", tipoMensaje: "text", texto: "hola" },
        interceptadoPor: "wf-elegido",
      },
      {
        workflows: {
          listarPublicadasPorDisparador: async () => [
            version("wf-elegido", true),
            version("wf-otro", true),
            version("wf-etiquetar", false),
          ],
        },
        runs,
      },
    );

    expect(arranque.iniciadas).toHaveLength(2);
    const arrancadas = await Promise.all(arranque.iniciadas.map((i) => runs.findRun(i.runId)));
    expect(arrancadas.map((r) => r?.workflow_version_id).sort()).toEqual([
      "v-wf-elegido",
      "v-wf-etiquetar",
    ]);
    const historial = await runs.listarHistorial("wf-otro", {});
    expect(historial.runs).toMatchObject([{ estado: "cancelado", error: MOTIVO_OTRO_INTERCEPTOR }]);
  });

  test("sólo la corrida del elegido lleva la marca de respuesta del turno", async () => {
    const runs = new InMemoryWorkflowRunsRepository((v) => v.replace(/^v-/, ""));
    const arranque = await arrancarPorDisparador(
      {
        disparador: "mensaje_recibido",
        leadId: LEAD,
        contexto: { lead: { canal: "wa" } },
        datos: { canal: "wa", tipoMensaje: "text", texto: "hola" },
        interceptadoPor: "wf-elegido",
      },
      {
        workflows: {
          listarPublicadasPorDisparador: async () => [
            version("wf-elegido", true),
            version("wf-etiquetar", false),
          ],
        },
        runs,
      },
    );

    const arrancadas = await Promise.all(arranque.iniciadas.map((i) => runs.findRun(i.runId)));
    const elegida = arrancadas.find((r) => r?.workflow_version_id === "v-wf-elegido");
    const otra = arrancadas.find((r) => r?.workflow_version_id === "v-wf-etiquetar");
    expect(elegida?.contexto).toMatchObject({
      lead: { canal: "wa" },
      [CLAVE_RESPUESTA_DE_TURNO]: true,
    });
    expect(otra?.contexto[CLAVE_RESPUESTA_DE_TURNO]).toBeUndefined();
  });

  test("sin `interceptadoPor` arrancan todos, interceptores incluidos", async () => {
    const runs = new InMemoryWorkflowRunsRepository((v) => v.replace(/^v-/, ""));
    const arranque = await arrancarPorDisparador(
      {
        disparador: "mensaje_recibido",
        leadId: LEAD,
        contexto: {},
        datos: { canal: "wa", tipoMensaje: "text", texto: "hola" },
      },
      {
        workflows: {
          listarPublicadasPorDisparador: async () => [version("wf-a", true), version("wf-b", true)],
        },
        runs,
      },
    );
    expect(arranque.iniciadas).toHaveLength(2);
  });
});
