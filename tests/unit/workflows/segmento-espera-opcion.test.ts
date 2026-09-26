import { describe, expect, it, vi } from "vitest";
import {
  datosDelSiguienteSegmento,
  filtroDeRespuestaInteractiva,
  segmentoHandler,
} from "@/inngest/functions/workflow-segmento";
import {
  CLAVE_ESPERA_OPCION,
  ESPERA_DE_OPCION_RESUELTA,
  esperaDeOpcionDe,
  marcarEsperaDeOpcion,
} from "@/lib/workflows/respuesta-interactiva";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import type { WorkflowRun } from "@/types/entities";
import { puertoDeOpcion, type Grafo } from "@/types/workflows";

/**
 * `workflow-segmento` con un nodo que espera una opción: el segmento que manda
 * devuelve a qué mensaje esperar la respuesta, y el que reanuda recibe la
 * opción elegida y la anota en la espera antes de volver a correr el nodo.
 */

const AHORA = new Date("2026-09-22T15:00:00Z");
const HASTA = new Date("2026-09-22T17:00:00Z");
const LEAD = "8de416bf-f7a8-4c77-aa2e-8ba5fd3ea42e";

const grafo: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_mensaje", config: {}, posicion: { x: 0, y: 0 } },
    { id: "b", tipo: "msg_botones", config: {}, posicion: { x: 0, y: 0 } },
    { id: "si", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
    { id: "nada", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
  ],
  aristas: [
    { desde: "t", hasta: "b", puerto: "salida" },
    { desde: "b", hasta: "si", puerto: puertoDeOpcion("si") },
    { desde: "b", hasta: "nada", puerto: "sin_respuesta" },
  ],
};

const registro = crearRegistro({
  enviar_botones: async (nodo, entorno) => {
    const espera = esperaDeOpcionDe(entorno.contexto, nodo.id);
    if (espera) {
      return {
        puerto: espera.respuesta ? puertoDeOpcion(espera.respuesta.id) : "sin_respuesta",
        contexto: ESPERA_DE_OPCION_RESUELTA,
      };
    }
    return {
      puerto: "sin_respuesta",
      esperarRespuesta: { hasta: HASTA, respondeA: "wamid.OUT" },
      contexto: marcarEsperaDeOpcion(nodo.id, "wamid.OUT"),
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

describe("segmento — nodo que espera una opción", () => {
  it("después de mandar devuelve a qué mensaje y de qué lead esperar la respuesta", async () => {
    const run = makeRun();
    const { runs, d } = deps(run);
    const r = await segmentoHandler({ runId: run.id, desdePaso: 0 }, d);
    expect(r).toEqual({
      tipo: "espera",
      nodoId: "b",
      hasta: HASTA.toISOString(),
      desdePaso: 2,
      esperaOpcion: { leadId: LEAD, respondeA: "wamid.OUT", desde: AHORA.toISOString() },
    });
    expect(runs.esperar).toHaveBeenCalledWith(
      run.id,
      "b",
      { [CLAVE_ESPERA_OPCION]: { nodoId: "b", respondeA: "wamid.OUT" } },
      2,
    );
  });

  it("al reanudar con la opción elegida sale por su línea", async () => {
    const run = makeRun({
      nodo_actual: "b",
      pasos_ejecutados: 2,
      contexto: marcarEsperaDeOpcion("b", "wamid.OUT"),
    });
    const { runs, d } = deps(run);
    const r = await segmentoHandler(
      { runId: run.id, desdePaso: 2, opcionElegida: { id: "si", titulo: "Sí" } },
      d,
    );
    expect(r).toEqual({ tipo: "fin" });
    expect(runs.registrarPaso.mock.calls.map((c) => (c as unknown[])[1])).toMatchObject([
      { nodo_id: "b" },
      { nodo_id: "si" },
    ]);
  });

  it("al reanudar sin opción sale por «sin respuesta»", async () => {
    const run = makeRun({
      nodo_actual: "b",
      pasos_ejecutados: 2,
      contexto: marcarEsperaDeOpcion("b", "wamid.OUT"),
    });
    const { runs, d } = deps(run);
    await segmentoHandler({ runId: run.id, desdePaso: 2 }, d);
    expect(runs.registrarPaso.mock.calls.map((c) => (c as unknown[])[1])).toMatchObject([
      { nodo_id: "b" },
      { nodo_id: "nada" },
    ]);
  });
});

describe("datosDelSiguienteSegmento — opción elegida", () => {
  it("la opción viaja al segmento siguiente", () => {
    expect(
      datosDelSiguienteSegmento({
        runId: "r1",
        desdePaso: 2,
        respondio: false,
        despertadoPor: null,
        opcionElegida: { id: "si", titulo: "Sí" },
      }),
    ).toEqual({ runId: "r1", desdePaso: 2, opcionElegida: { id: "si", titulo: "Sí" } });
  });
});

describe("filtroDeRespuestaInteractiva", () => {
  it("filtra por lead y por el wamid respondido", () => {
    expect(filtroDeRespuestaInteractiva(LEAD, "wamid.HBgL=")).toBe(
      `async.data.leadId == '${LEAD}' && async.data.respondeA == 'wamid.HBgL='`,
    );
  });

  it("sin wamid filtra sólo por lead", () => {
    expect(filtroDeRespuestaInteractiva(LEAD, null)).toBe(`async.data.leadId == '${LEAD}'`);
  });

  it("rechaza lo que podría romper las comillas de la expresión", () => {
    expect(() => filtroDeRespuestaInteractiva(LEAD, "x' || true || '")).toThrow();
    expect(() => filtroDeRespuestaInteractiva("l' || '1", null)).toThrow();
  });
});
