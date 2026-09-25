import { describe, expect, it, vi } from "vitest";
import { ConflictError, InfraError, ValidationError, isNonRetriable } from "@/lib/errors";
import { arrancarPorDisparador, dispararHandler } from "@/inngest/functions/workflow-disparar";
import type { EmitirSegmentoPendienteInput } from "@/inngest/functions/workflow-disparar";
import {
  filtroDeEspera,
  segmentoFalloHandler,
  segmentoHandler,
} from "@/inngest/functions/workflow-segmento";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import type { WorkflowRun } from "@/types/entities";
import type { Grafo, NodoTipo } from "@/types/workflows";

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

/** Una versión publicada como la devuelve el repo: lo que importa acá es su grafo. */
function version(id: string, grafo: Grafo) {
  return { id, max_pasos: 500, grafo };
}

function grafoLegacy(disparador: string): Grafo {
  return {
    nodos: [
      { id: "d", tipo: "disparador", config: { disparador }, posicion: { x: 0, y: 0 } },
      { id: "f", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
    ],
    aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
  };
}

function grafoCanvas(tipo: NodoTipo, config: Record<string, unknown> = {}): Grafo {
  return {
    nodos: [
      { id: "t", tipo, config, posicion: { x: 0, y: 0 } },
      { id: "fin", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
    ],
    aristas: [{ desde: "t", hasta: "fin", puerto: "salida" }],
  };
}

describe("dispararHandler", () => {
  it("no arranca nada cuando la politica dice ignorar y ya hay una corrida viva", async () => {
    const runs = {
      arrancar: vi.fn(async () => ({ run: null, motivo: "ya_hay_corrida_viva" as const })),
    };
    const workflows = {
      listarPublicadasPorDisparador: vi.fn(async (d: string) => [version("v1", grafoLegacy(d))]),
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
      listarPublicadasPorDisparador: vi.fn(async (d: string) => [
        version("v1", grafoLegacy(d)),
        version("v2", grafoLegacy(d)),
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
      listarPublicadasPorDisparador: vi.fn(async (d: string) => [
        version("v1", grafoLegacy(d)),
        version("v2", grafoLegacy(d)),
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

  // Fix round 1 (Important): pinea el seam entre los dos steps de
  // `makeWorkflowDispararFn`. `arrancarPorDisparador` es el primer step
  // (arrancar); el segundo step del wrapper real sólo hace un loop de
  // `emitir` sobre lo que el primero devolvió -- acá se simula ese segundo
  // step con el mismo loop, contra el resultado YA CAPTURADO del primero,
  // para probar que reejecutar la fase de emit no necesita (ni puede, en
  // Inngest real: el primer step ya está memoizado) volver a llamar
  // `runs.arrancar`. No hay harness de Inngest en este repo que simule la
  // memoización real de `step.run`; esto prueba la propiedad al nivel del
  // seam real entre las dos funciones que el wrapper compone.
  it("el resultado de arrancarPorDisparador alcanza para emitir sin volver a invocar arrancar", async () => {
    const runs = {
      arrancar: vi
        .fn()
        .mockResolvedValueOnce({ run: makeRun({ id: "run-a" }) })
        .mockResolvedValueOnce({ run: makeRun({ id: "run-b" }) }),
    };
    const workflows = {
      listarPublicadasPorDisparador: vi.fn(async (d: string) => [
        version("v1", grafoLegacy(d)),
        version("v2", grafoLegacy(d)),
      ]),
    };

    // Fase 1 ("step arrancar"): arma la lista JSON-safe.
    const iniciadas = await arrancarPorDisparador(
      { disparador: "etiqueta_asignada", leadId: "l1", contexto: {} },
      { runs, workflows } as never,
    );
    expect(iniciadas).toEqual([
      { runId: "run-a", desdePaso: 0 },
      { runId: "run-b", desdePaso: 0 },
    ]);
    expect(runs.arrancar).toHaveBeenCalledTimes(2);

    // Fase 2 ("step emitir"), simulada contra el resultado YA CAPTURADO --
    // ningun nuevo llamado a listarPublicadasPorDisparador ni a arrancar.
    const emitir = vi.fn(async (_input: EmitirSegmentoPendienteInput) => {});
    for (const iniciada of iniciadas) {
      await emitir(iniciada);
    }

    expect(emitir).toHaveBeenCalledTimes(2);
    // El seam que importa: la fase 2 no volvio a tocar arrancar.
    expect(runs.arrancar).toHaveBeenCalledTimes(2);
    expect(workflows.listarPublicadasPorDisparador).toHaveBeenCalledTimes(1);
  });

  // Corte 2 + filtros: el repo trae las versiones que escuchan el evento
  // (chequeo grueso); el despacho aplica la configuración del trigger.
  it("sólo arranca el flujo cuya etiqueta es la que se puso", async () => {
    const runs = {
      arrancar: vi.fn(async () => ({ run: makeRun({ id: "run-t1" }) })),
    };
    const workflows = {
      listarPublicadasPorDisparador: vi.fn(async () => [
        version("v-t1", grafoCanvas("trigger_etiqueta", { tagId: "t1" })),
        version("v-t2", grafoCanvas("trigger_etiqueta", { tagId: "t2" })),
      ]),
    };
    const emitir = vi.fn(async () => {});
    const r = await dispararHandler(
      { disparador: "etiqueta_asignada", leadId: "l1", contexto: {}, datos: { tagId: "t1" } },
      { runs, workflows, emitir } as never,
    );
    expect(r.arrancadas).toBe(1);
    expect(runs.arrancar).toHaveBeenCalledTimes(1);
    expect(runs.arrancar).toHaveBeenCalledWith(expect.objectContaining({ versionId: "v-t1" }));
  });

  it("un flujo armado en el canvas arranca con el evento de su trigger", async () => {
    const runs = { arrancar: vi.fn(async () => ({ run: makeRun({ id: "run-m" }) })) };
    const workflows = {
      listarPublicadasPorDisparador: vi.fn(async () => [
        version("v-m", grafoCanvas("trigger_mensaje", { canal: "whatsapp" })),
      ]),
    };
    const emitir = vi.fn(async () => {});
    const r = await dispararHandler(
      {
        disparador: "mensaje_recibido",
        leadId: "l1",
        leadSessionId: "s1",
        contexto: {},
        datos: { canal: "wa", tipoMensaje: "text", texto: "hola" },
      },
      { runs, workflows, emitir } as never,
    );
    expect(r.arrancadas).toBe(1);
    expect(emitir).toHaveBeenCalledWith({ runId: "run-m", desdePaso: 0 });
  });

  it("un evento sin datos no satisface un trigger con filtro (falla cerrado)", async () => {
    const runs = { arrancar: vi.fn() };
    const workflows = {
      listarPublicadasPorDisparador: vi.fn(async () => [
        version("v-t1", grafoCanvas("trigger_etiqueta", { tagId: "t1" })),
      ]),
    };
    const r = await dispararHandler(
      { disparador: "etiqueta_asignada", leadId: "l1", contexto: {} },
      {
        runs,
        workflows,
        emitir: vi.fn(),
      } as never,
    );
    expect(r.arrancadas).toBe(0);
    expect(runs.arrancar).not.toHaveBeenCalled();
  });

  // Programado, inactividad y manual los emite alguien que ya eligió el flujo:
  // el disparo lo nombra y sólo ése arranca.
  it("un disparo dirigido sólo arranca el workflow que nombra", async () => {
    const runs = { arrancar: vi.fn(async () => ({ run: makeRun({ id: "run-w1" }) })) };
    const workflows = {
      listarPublicadasPorDisparador: vi.fn(async () => [
        { ...version("v-w1", grafoCanvas("trigger_manual")), workflow_id: "w1" },
        { ...version("v-w2", grafoCanvas("trigger_manual")), workflow_id: "w2" },
      ]),
    };
    const emitir = vi.fn(async () => {});
    const r = await dispararHandler(
      { disparador: "manual", workflowId: "w1", leadId: "l1", contexto: {} },
      { runs, workflows, emitir } as never,
    );
    expect(r.arrancadas).toBe(1);
    expect(runs.arrancar).toHaveBeenCalledTimes(1);
    expect(runs.arrancar).toHaveBeenCalledWith(expect.objectContaining({ versionId: "v-w1" }));
  });

  it("un disparo dirigido sin workflowId no arranca nada (falla cerrado)", async () => {
    const runs = { arrancar: vi.fn() };
    const workflows = {
      listarPublicadasPorDisparador: vi.fn(async () => [
        { ...version("v-w1", grafoCanvas("trigger_manual")), workflow_id: "w1" },
      ]),
    };
    const r = await dispararHandler({ disparador: "manual", leadId: "l1", contexto: {} }, {
      runs,
      workflows,
      emitir: vi.fn(),
    } as never);
    expect(r.arrancadas).toBe(0);
    expect(runs.arrancar).not.toHaveBeenCalled();
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
    const deps = { runs, workflows, registro, ahora: () => AHORA } as never;

    await expect(segmentoHandler({ runId: run.id, desdePaso: 0 }, deps)).rejects.toThrow(
      "timeout de red",
    );
    expect(runs.fallar).not.toHaveBeenCalled();
    expect(runs.terminar).not.toHaveBeenCalled();
    expect(runs.esperar).not.toHaveBeenCalled();

    // Fix round 1 (Minor): el error tirado es un InfraError -- clase de
    // dominio, no un `Error` a secas -- y sigue dando `retriable` (Inngest
    // reintenta) porque InfraError NO esta en isNonRetriable(). Si alguna
    // vez InfraError se agregara a esa lista por error, este test lo
    // detecta: el comportamiento de retry se invertiria en silencio.
    let capturado: unknown;
    try {
      await segmentoHandler({ runId: run.id, desdePaso: 0 }, deps);
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBeInstanceOf(InfraError);
    expect((capturado as InfraError).dependency).toBe("a");
    expect(isNonRetriable(capturado)).toBe(false);
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

describe("segmentoHandler — esperas de evento", () => {
  const LEAD = "8de416bf-f7a8-4c77-aa2e-8ba5fd3ea42e";

  function runsQueDevuelven(run: WorkflowRun) {
    return {
      tomarSegmento: vi.fn(async () => run),
      registrarPaso: vi.fn(async () => {}),
      esperar: vi.fn(async () => {}),
      terminar: vi.fn(async () => {}),
      fallar: vi.fn(async () => {}),
    };
  }

  function workflowsCon(grafo: Grafo) {
    return {
      findVersion: vi.fn(async () => ({
        id: "v1",
        workflow_id: "w1",
        version: 1,
        grafo,
        max_pasos: 500,
        publicada: true,
        created_at: AHORA,
        created_by: null,
        politica_concurrencia: "ignorar" as const,
      })),
    };
  }

  const grafoRespuesta: Grafo = {
    nodos: [
      { id: "t", tipo: "trigger_mensaje", config: {}, posicion: { x: 0, y: 0 } },
      {
        id: "w",
        tipo: "logica_esperar_respuesta",
        config: { timeout: 1, unidadTimeout: "horas" },
        posicion: { x: 0, y: 0 },
      },
      {
        id: "c",
        tipo: "logica_condicion",
        config: { campo: "sesion.respondio", operador: "es_verdadero", valor: null },
        posicion: { x: 0, y: 0 },
      },
      { id: "a", tipo: "accion", config: { accion: "marcar" }, posicion: { x: 0, y: 0 } },
      { id: "f", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
    ],
    aristas: [
      { desde: "t", hasta: "w", puerto: "salida" },
      { desde: "w", hasta: "c", puerto: "salida" },
      { desde: "c", hasta: "a", puerto: "verdadero" },
      { desde: "c", hasta: "f", puerto: "falso" },
      { desde: "a", hasta: "f", puerto: "salida" },
    ],
  };

  it("una espera de respuesta dice qué evento la despierta y de qué lead", async () => {
    const run = makeRun({ lead_id: LEAD });
    const runs = runsQueDevuelven(run);
    const r = await segmentoHandler({ runId: run.id, desdePaso: 0 }, {
      runs,
      workflows: workflowsCon(grafoRespuesta),
      registro: crearRegistro({ marcar: async () => ({ puerto: "salida" }) }),
      ahora: () => AHORA,
    } as never);

    expect(r).toEqual({
      tipo: "espera",
      nodoId: "w",
      hasta: new Date(AHORA.getTime() + 60 * 60_000).toISOString(),
      desdePaso: 2,
      esperaEvento: {
        tipo: "respuesta",
        disparador: "mensaje_recibido",
        leadId: LEAD,
        desde: AHORA.toISOString(),
      },
    });
    // Se guarda "no respondió": lo que queda si vence el tiempo.
    expect(runs.esperar).toHaveBeenCalledWith(run.id, "c", { sesion: { respondio: false } }, 2);
  });

  it("al reanudar porque el lead contestó, el contexto dice que respondió", async () => {
    const run = makeRun({
      lead_id: LEAD,
      nodo_actual: "c",
      pasos_ejecutados: 2,
      contexto: { sesion: { respondio: false } },
    });
    const marcar = vi.fn(async () => ({ puerto: "salida" as const }));
    await segmentoHandler({ runId: run.id, desdePaso: 2, respondio: true }, {
      runs: runsQueDevuelven(run),
      workflows: workflowsCon(grafoRespuesta),
      registro: crearRegistro({ marcar }),
      ahora: () => AHORA,
    } as never);
    expect(marcar).toHaveBeenCalledTimes(1);
  });

  it("al reanudar por tiempo vencido, sigue diciendo que no respondió", async () => {
    const run = makeRun({
      lead_id: LEAD,
      nodo_actual: "c",
      pasos_ejecutados: 2,
      contexto: { sesion: { respondio: false } },
    });
    const marcar = vi.fn(async () => ({ puerto: "salida" as const }));
    await segmentoHandler({ runId: run.id, desdePaso: 2 }, {
      runs: runsQueDevuelven(run),
      workflows: workflowsCon(grafoRespuesta),
      registro: crearRegistro({ marcar }),
      ahora: () => AHORA,
    } as never);
    expect(marcar).not.toHaveBeenCalled();
  });

  it("una espera de tiempo no espera ningún evento", async () => {
    const run = makeRun();
    const r = await segmentoHandler({ runId: run.id, desdePaso: 0 }, {
      runs: runsQueDevuelven(run),
      workflows: workflowsCon(grafoLineal()),
      registro: crearRegistro({ marcar: async () => ({ puerto: "salida" }) }),
      ahora: () => AHORA,
    } as never);
    expect(r).not.toHaveProperty("esperaEvento");
  });
});

describe("filtroDeEspera", () => {
  it("sólo el evento de ese lead y de ese disparador despierta la espera", () => {
    expect(filtroDeEspera("8de416bf-f7a8-4c77-aa2e-8ba5fd3ea42e", "mensaje_recibido")).toBe(
      "async.data.leadId == '8de416bf-f7a8-4c77-aa2e-8ba5fd3ea42e' && async.data.disparador == 'mensaje_recibido'",
    );
  });

  it("un id con comillas no entra en la expresión", () => {
    expect(() => filtroDeEspera("x' || true || '", "mensaje_recibido")).toThrow(ValidationError);
  });
});

// MUST-FIX 1 (review de rama completa): sin `onFailure`, una corrida que
// agota los reintentos de Inngest queda para siempre en `corriendo`/
// `esperando` -- invisible y, con `politica_concurrencia: 'ignorar'` (la
// default), ese workflow nunca vuelve a dispararse para ese lead.
describe("segmentoFalloHandler (onFailure de workflow-segmento)", () => {
  it("una corrida que se quedó en 'corriendo' se marca fallado", async () => {
    const runs = { fallarSiVivo: vi.fn(async () => true) };
    const r = await segmentoFalloHandler(
      { runId: "run-1", desdePaso: 2, mensaje: "timeout de red" },
      { runs } as never,
    );
    expect(r).toEqual({ marcado: true });
    expect(runs.fallarSiVivo).toHaveBeenCalledWith(
      "run-1",
      expect.stringContaining("timeout de red"),
      2,
    );
    // El mensaje deja explícito que se agotaron los reintentos -- no sólo
    // repite el error crudo, que por sí solo parecería un fallo cualquiera.
    expect(runs.fallarSiVivo).toHaveBeenCalledWith(
      "run-1",
      expect.stringContaining("agotados los reintentos"),
      2,
    );
  });

  it("una corrida ya 'terminado' NO se toca -- fallarSiVivo hizo de CAS y devolvió false", async () => {
    const runs = { fallarSiVivo: vi.fn(async () => false) };
    const r = await segmentoFalloHandler(
      { runId: "run-2", desdePaso: 5, mensaje: "timeout de red" },
      { runs } as never,
    );
    expect(r).toEqual({ marcado: false });
    // El handler no reintenta ni escala distinto -- confía en el CAS del
    // repo. Este test fija que el resultado de `fallarSiVivo` se propaga
    // sin transformarlo, para que un futuro cambio no le agregue un "reintentar
    // si false" que resucitaría corridas cerradas.
    expect(runs.fallarSiVivo).toHaveBeenCalledTimes(1);
  });
});
