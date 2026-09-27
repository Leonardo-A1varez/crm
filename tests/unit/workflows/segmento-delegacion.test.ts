import { describe, expect, it, vi } from "vitest";
import {
  datosDelSiguienteSegmento,
  filtroDeTurnoAgente,
  segmentoHandler,
} from "@/inngest/functions/workflow-segmento";
import {
  DELEGACION_TERMINADA,
  delegacionDe,
  marcarDelegacion,
  type TurnoDelegacion,
} from "@/lib/workflows/delegacion";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import type { WorkflowRun } from "@/types/entities";
import type { Grafo } from "@/types/workflows";

/**
 * `workflow-segmento` con "Delegar al agente": el segmento que arranca el
 * tramo devuelve qué lead observar, y el que reanuda recibe el turno del agente
 * y lo anota en el tramo antes de volver a correr el nodo.
 */

const AHORA = new Date("2026-09-26T10:00:00Z");
const HASTA = new Date("2026-09-27T10:00:00Z");
const LEAD = "8de416bf-f7a8-4c77-aa2e-8ba5fd3ea42e";

const grafo: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_lead_creado", config: {}, posicion: { x: 0, y: 0 } },
    { id: "d", tipo: "ia_delegar", config: {}, posicion: { x: 0, y: 0 } },
    { id: "ok", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
    { id: "nada", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
  ],
  aristas: [
    { desde: "t", hasta: "d", puerto: "salida" },
    { desde: "d", hasta: "ok", puerto: "resuelto" },
    { desde: "d", hasta: "nada", puerto: "sin_respuesta" },
  ],
};

const ESTADO = {
  nodoId: "d",
  desde: AHORA.toISOString(),
  hasta: HASTA.toISOString(),
  turnos: 0,
  costoBaseUsd: 0,
  instrucciones: null,
};

/** Una delegación mínima: la lógica de verdad está en `acciones/delegar.ts`. */
const registro = crearRegistro({
  delegar_al_agente: async (nodo, entorno) => {
    const estado = delegacionDe(entorno.contexto, nodo.id);
    if (!estado) {
      return {
        puerto: "sin_respuesta",
        esperarTurnoAgente: { hasta: HASTA },
        contexto: marcarDelegacion(ESTADO),
      };
    }
    return {
      puerto: estado.ultimo?.intentId === "i1" ? "resuelto" : "sin_respuesta",
      contexto: DELEGACION_TERMINADA,
    };
  },
});

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    workflow_version_id: "v1",
    lead_id: LEAD,
    lead_session_id: null,
    estado: "corriendo",
    nodo_actual: null,
    contexto: {},
    pasos_ejecutados: 0,
    error: null,
    started_at: AHORA,
    ended_at: null,
    ...overrides,
  };
}

function deps(run: WorkflowRun) {
  const runs = {
    tomarSegmento: vi.fn(async () => run),
    findRun: vi.fn(async () => run),
    registrarPaso: vi.fn(async () => {}),
    esperar: vi.fn(async () => {}),
    terminar: vi.fn(async () => {}),
    fallar: vi.fn(async () => {}),
  };
  const workflows = {
    findVersion: vi.fn(async () => ({ id: "v1", grafo, max_pasos: 50 })),
  };
  return { runs, d: { runs, workflows, registro, ahora: () => AHORA } as never };
}

const TURNO: TurnoDelegacion = {
  tipo: "turno",
  mensajeId: "m1",
  runIds: ["run-1"],
  intentId: "i1",
  respondio: true,
};

describe("segmento — Delegar al agente", () => {
  it("al arrancar el tramo devuelve qué lead observar y hasta cuándo", async () => {
    const run = makeRun();
    const { runs, d } = deps(run);
    const r = await segmentoHandler({ runId: run.id, desdePaso: 0 }, d);
    expect(r).toEqual({
      tipo: "espera",
      nodoId: "d",
      hasta: HASTA.toISOString(),
      desdePaso: 2,
      esperaTurnoAgente: { leadId: LEAD, desde: AHORA.toISOString() },
    });
    expect(runs.esperar).toHaveBeenCalledWith(run.id, "d", marcarDelegacion(ESTADO), 2);
  });

  it("al reanudar con el turno lo anota y el nodo decide", async () => {
    const run = makeRun({
      nodo_actual: "d",
      pasos_ejecutados: 2,
      contexto: marcarDelegacion(ESTADO),
    });
    const { runs, d } = deps(run);
    const r = await segmentoHandler({ runId: run.id, desdePaso: 2, turnoAgente: TURNO }, d);
    expect(r).toEqual({ tipo: "fin" });
    expect(runs.registrarPaso.mock.calls.map((c) => (c as unknown[])[1])).toMatchObject([
      { nodo_id: "d" },
      { nodo_id: "ok" },
    ]);
  });

  it("al reanudar sin turno (venció) el nodo lo ve sin turno", async () => {
    const run = makeRun({
      nodo_actual: "d",
      pasos_ejecutados: 2,
      contexto: marcarDelegacion(ESTADO),
    });
    const { runs, d } = deps(run);
    await segmentoHandler({ runId: run.id, desdePaso: 2 }, d);
    expect(runs.registrarPaso.mock.calls.map((c) => (c as unknown[])[1])).toMatchObject([
      { nodo_id: "d" },
      { nodo_id: "nada" },
    ]);
  });
});

describe("datosDelSiguienteSegmento — turno del agente", () => {
  it("el turno viaja al segmento siguiente", () => {
    expect(
      datosDelSiguienteSegmento({
        runId: "r1",
        desdePaso: 2,
        respondio: false,
        despertadoPor: null,
        turnoAgente: TURNO,
      }),
    ).toEqual({ runId: "r1", desdePaso: 2, turnoAgente: TURNO });
  });
});

describe("filtroDeTurnoAgente", () => {
  it("filtra por lead", () => {
    expect(filtroDeTurnoAgente(LEAD)).toBe(`async.data.leadId == '${LEAD}'`);
  });

  it("rechaza lo que podría romper las comillas de la expresión", () => {
    expect(() => filtroDeTurnoAgente("l' || '1")).toThrow();
  });
});
