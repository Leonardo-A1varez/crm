import { describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@/lib/errors";
import { dispararHandler } from "@/inngest/functions/workflow-disparar";
import { segmentoHandler } from "@/inngest/functions/workflow-segmento";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import type { WorkflowRun } from "@/types/entities";
import type { Grafo } from "@/types/workflows";

const AHORA = new Date("2026-08-22T10:00:00Z");

function grafoLineal(): Grafo {
  return {
    nodos: [
      {
        id: "d",
        tipo: "disparador",
        config: { disparador: "etiqueta_asignada" },
        posicion: { x: 0, y: 0 },
      },
      { id: "a", tipo: "accion", config: { accion: "marcar" }, posicion: { x: 0, y: 0 } },
      { id: "w", tipo: "espera", config: { minutos: 60 }, posicion: { x: 0, y: 0 } },
      { id: "f", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
    ],
    aristas: [
      { desde: "d", hasta: "a", puerto: "salida" },
      { desde: "a", hasta: "w", puerto: "salida" },
      { desde: "w", hasta: "f", puerto: "salida" },
    ],
  };
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    workflow_version_id: "v1",
    lead_id: "l1",
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

describe("dispararHandler", () => {
  it("no arranca nada cuando la politica dice ignorar y ya hay una corrida viva", async () => {
    const runs = {
      arrancar: vi.fn(async () => ({ run: null, motivo: "ya_hay_corrida_viva" as const })),
    };
    const workflows = {
      listarPublicadasPorDisparador: vi.fn(async () => [{ id: "v1", max_pasos: 500 }]),
    };
    const emitir = vi.fn(async () => {});
    const r = await dispararHandler(
      { disparador: "etiqueta_asignada", leadId: "l1", contexto: {} },
      { runs, workflows, emitir } as never,
    );
    expect(emitir).not.toHaveBeenCalled();
    expect(r.arrancadas).toBe(0);
  });

  it("arranca una corrida por cada version publicada que matchea y emite el primer segmento", async () => {
    const runs = {
      arrancar: vi
        .fn()
        .mockResolvedValueOnce({ run: makeRun({ id: "run-a", workflow_version_id: "v1" }) })
        .mockResolvedValueOnce({ run: makeRun({ id: "run-b", workflow_version_id: "v2" }) }),
    };
    const workflows = {
      listarPublicadasPorDisparador: vi.fn(async () => [
        { id: "v1", max_pasos: 500 },
        { id: "v2", max_pasos: 500 },
      ]),
    };
    const emitir = vi.fn(async () => {});
    const r = await dispararHandler(
      { disparador: "mensaje_recibido", leadId: "l1", leadSessionId: "s1", contexto: { x: 1 } },
      { runs, workflows, emitir } as never,
    );
    expect(r.arrancadas).toBe(2);
    expect(emitir).toHaveBeenCalledTimes(2);
    expect(emitir).toHaveBeenNthCalledWith(1, { runId: "run-a", desdePaso: 0 });
    expect(emitir).toHaveBeenNthCalledWith(2, { runId: "run-b", desdePaso: 0 });
    expect(runs.arrancar).toHaveBeenCalledWith({
      versionId: "v1",
      leadId: "l1",
      sessionId: "s1",
      contexto: { x: 1 },
    });
  });

  it("una version sin corrida viva arranca; otra con corrida viva no emite -- arrancadas cuenta solo la real", async () => {
    const runs = {
      arrancar: vi
        .fn()
        .mockResolvedValueOnce({ run: makeRun({ id: "run-a" }) })
        .mockResolvedValueOnce({ run: null, motivo: "ya_hay_corrida_viva" as const }),
    };
    const workflows = {
      listarPublicadasPorDisparador: vi.fn(async () => [
        { id: "v1", max_pasos: 500 },
        { id: "v2", max_pasos: 500 },
      ]),
    };
    const emitir = vi.fn(async () => {});
    const r = await dispararHandler({ disparador: "etapa_cambiada", leadId: "l1", contexto: {} }, {
      runs,
      workflows,
      emitir,
    } as never);
    expect(r.arrancadas).toBe(1);
    expect(emitir).toHaveBeenCalledTimes(1);
    expect(emitir).toHaveBeenCalledWith({ runId: "run-a", desdePaso: 0 });
  });

  it("ninguna version publicada matchea: no arranca ni emite nada", async () => {
    const runs = { arrancar: vi.fn() };
    const workflows = { listarPublicadasPorDisparador: vi.fn(async () => []) };
    const emitir = vi.fn(async () => {});
    const r = await dispararHandler(
      { disparador: "etiqueta_asignada", leadId: "l1", contexto: {} },
      { runs, workflows, emitir } as never,
    );
    expect(r.arrancadas).toBe(0);
    expect(runs.arrancar).not.toHaveBeenCalled();
    expect(emitir).not.toHaveBeenCalled();
  });
});

describe("segmentoHandler", () => {
  function marcarRegistro(
    impl: () => Promise<{ puerto: "salida" }> = async () => ({
      puerto: "salida",
    }),
  ) {
    return crearRegistro({ marcar: impl });
  }

  it("sale sin ruido cuando tomarSegmento devuelve null (ya corrio o lo cancelaron)", async () => {
    const runs = {
      tomarSegmento: vi.fn(async () => null),
      registrarPaso: vi.fn(),
      esperar: vi.fn(),
      terminar: vi.fn(),
      fallar: vi.fn(),
    };
    const workflows = { findVersion: vi.fn() };
    const r = await segmentoHandler({ runId: "run-1", desdePaso: 3 }, {
      runs,
      workflows,
      registro: marcarRegistro(),
    } as never);
    expect(r).toEqual({ tipo: "no-op" });
    expect(workflows.findVersion).not.toHaveBeenCalled();
    expect(runs.registrarPaso).not.toHaveBeenCalled();
  });

  it("lee la version PINNEADA de la corrida, no busca la publicada", async () => {
    const run = makeRun({ workflow_version_id: "v-pinneada" });
    const runs = {
      tomarSegmento: vi.fn(async () => run),
      registrarPaso: vi.fn(async () => {}),
      esperar: vi.fn(async () => {}),
      terminar: vi.fn(async () => {}),
      fallar: vi.fn(async () => {}),
    };
    const workflows = {
      findVersion: vi.fn(async () => ({
        id: "v-pinneada",
        workflow_id: "w1",
        version: 1,
        grafo: grafoLineal(),
        max_pasos: 500,
        publicada: false,
        created_at: AHORA,
        created_by: null,
        politica_concurrencia: "ignorar" as const,
      })),
    };
    await segmentoHandler({ runId: run.id, desdePaso: 0 }, {
      runs,
      workflows,
      registro: marcarRegistro(),
      ahora: () => AHORA,
    } as never);
    expect(workflows.findVersion).toHaveBeenCalledWith("v-pinneada");
  });

  it("primer segmento arranca en el disparador y corre hasta la espera, persistiendo contexto+nodo+pasos", async () => {
    const run = makeRun();
    const runs = {
      tomarSegmento: vi.fn(async () => run),
      registrarPaso: vi.fn(async () => {}),
      esperar: vi.fn(async () => {}),
      terminar: vi.fn(async () => {}),
      fallar: vi.fn(async () => {}),
    };
    const workflows = {
      findVersion: vi.fn(async () => ({
        id: "v1",
        workflow_id: "w1",
        version: 1,
        grafo: grafoLineal(),
        max_pasos: 500,
        publicada: true,
        created_at: AHORA,
        created_by: null,
        politica_concurrencia: "ignorar" as const,
      })),
    };
    const r = await segmentoHandler({ runId: run.id, desdePaso: 0 }, {
      runs,
      workflows,
      registro: marcarRegistro(),
      ahora: () => AHORA,
    } as never);
    // d, a, w: 3 pasos.
    expect(runs.esperar).toHaveBeenCalledWith(run.id, "f", {}, 3);
    expect(runs.terminar).not.toHaveBeenCalled();
    expect(runs.fallar).not.toHaveBeenCalled();
    expect(r).toEqual({
      tipo: "espera",
      nodoId: "w",
      hasta: new Date(AHORA.getTime() + 60 * 60_000).toISOString(),
      desdePaso: 3,
    });
  });

  it("un segmento que resuena en un nodo intermedio llega al fin y termina la corrida", async () => {
    const run = makeRun({ nodo_actual: "f", pasos_ejecutados: 3 });
    const runs = {
      tomarSegmento: vi.fn(async () => run),
      registrarPaso: vi.fn(async () => {}),
      esperar: vi.fn(async () => {}),
      terminar: vi.fn(async () => {}),
      fallar: vi.fn(async () => {}),
    };
    const workflows = {
      findVersion: vi.fn(async () => ({
        id: "v1",
        workflow_id: "w1",
        version: 1,
        grafo: grafoLineal(),
        max_pasos: 500,
        publicada: true,
        created_at: AHORA,
        created_by: null,
        politica_concurrencia: "ignorar" as const,
      })),
    };
    const r = await segmentoHandler({ runId: run.id, desdePaso: 3 }, {
      runs,
      workflows,
      registro: marcarRegistro(),
      ahora: () => AHORA,
    } as never);
    expect(runs.terminar).toHaveBeenCalledWith(run.id, 4);
    expect(runs.esperar).not.toHaveBeenCalled();
    expect(r).toEqual({ tipo: "fin" });
  });

  it("una accion que falla con un error NO retriable marca la corrida fallada y no tira", async () => {
    const run = makeRun();
    const runs = {
      tomarSegmento: vi.fn(async () => run),
      registrarPaso: vi.fn(async () => {}),
      esperar: vi.fn(async () => {}),
      terminar: vi.fn(async () => {}),
      fallar: vi.fn(async () => {}),
    };
    const workflows = {
      findVersion: vi.fn(async () => ({
        id: "v1",
        workflow_id: "w1",
        version: 1,
        grafo: grafoLineal(),
        max_pasos: 500,
        publicada: true,
        created_at: AHORA,
        created_by: null,
        politica_concurrencia: "ignorar" as const,
      })),
    };
    const registro = crearRegistro({
      marcar: async () => {
        throw new ValidationError("dato invalido", "campo");
      },
    });
    const r = await segmentoHandler({ runId: run.id, desdePaso: 0 }, {
      runs,
      workflows,
      registro,
      ahora: () => AHORA,
    } as never);
    expect(runs.fallar).toHaveBeenCalledWith(run.id, expect.stringContaining("dato invalido"), 2);
    expect(r).toEqual({ tipo: "fallado", nodoId: "a", motivo: "accion_fallo" });
  });

  it("una accion que falla con un error retriable tira -- Inngest debe reintentar el step, no se marca la corrida", async () => {
    const run = makeRun();
    const runs = {
      tomarSegmento: vi.fn(async () => run),
      registrarPaso: vi.fn(async () => {}),
      esperar: vi.fn(async () => {}),
      terminar: vi.fn(async () => {}),
      fallar: vi.fn(async () => {}),
    };
    const workflows = {
      findVersion: vi.fn(async () => ({
        id: "v1",
        workflow_id: "w1",
        version: 1,
        grafo: grafoLineal(),
        max_pasos: 500,
        publicada: true,
        created_at: AHORA,
        created_by: null,
        politica_concurrencia: "ignorar" as const,
      })),
    };
    const registro = crearRegistro({
      marcar: async () => {
        throw new Error("timeout de red");
      },
    });
    await expect(
      segmentoHandler({ runId: run.id, desdePaso: 0 }, {
        runs,
        workflows,
        registro,
        ahora: () => AHORA,
      } as never),
    ).rejects.toThrow("timeout de red");
    expect(runs.fallar).not.toHaveBeenCalled();
    expect(runs.terminar).not.toHaveBeenCalled();
    expect(runs.esperar).not.toHaveBeenCalled();
  });

  it("version pinneada ausente: falla la corrida en voz alta, no explota", async () => {
    const run = makeRun({ workflow_version_id: "version-borrada" });
    const runs = {
      tomarSegmento: vi.fn(async () => run),
      registrarPaso: vi.fn(async () => {}),
      esperar: vi.fn(async () => {}),
      terminar: vi.fn(async () => {}),
      fallar: vi.fn(async () => {}),
    };
    const workflows = { findVersion: vi.fn(async () => null) };
    const r = await segmentoHandler({ runId: run.id, desdePaso: 0 }, {
      runs,
      workflows,
      registro: marcarRegistro(),
    } as never);
    expect(runs.fallar).toHaveBeenCalledWith(run.id, expect.stringContaining("version-borrada"), 0);
    expect(r).toEqual({ tipo: "fallado", nodoId: null, motivo: "version_ausente" });
  });

  it("un reintento que repite el mismo orden no revienta por el UNIQUE de auditoria", async () => {
    // Simula el segundo intento de un segmento retriable: registrarPaso
    // rechaza el (run_id, orden) ya escrito por el intento anterior.
    const run = makeRun();
    const runs = {
      tomarSegmento: vi.fn(async () => run),
      registrarPaso: vi.fn(async () => {
        throw new ConflictError("duplicado", "workflow_run_pasos_orden_unico");
      }),
      esperar: vi.fn(async () => {}),
      terminar: vi.fn(async () => {}),
      fallar: vi.fn(async () => {}),
    };
    const workflows = {
      findVersion: vi.fn(async () => ({
        id: "v1",
        workflow_id: "w1",
        version: 1,
        grafo: grafoLineal(),
        max_pasos: 500,
        publicada: true,
        created_at: AHORA,
        created_by: null,
        politica_concurrencia: "ignorar" as const,
      })),
    };
    const r = await segmentoHandler({ runId: run.id, desdePaso: 0 }, {
      runs,
      workflows,
      registro: marcarRegistro(),
      ahora: () => AHORA,
    } as never);
    // A pesar de que CADA registrarPaso tira ConflictError, el segmento
    // termina normalmente en la espera -- el conflicto se ignora.
    expect(r).toMatchObject({ tipo: "espera", nodoId: "w" });
    expect(runs.esperar).toHaveBeenCalledWith(run.id, "f", {}, 3);
  });
});
