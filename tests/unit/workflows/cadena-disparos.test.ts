import { describe, expect, it, vi } from "vitest";
import { makeAvisosDeAsignacion } from "@/inngest/callbacks/workflow-adapters";
import { arrancarPorDisparador, dispararHandler } from "@/inngest/functions/workflow-disparar";
import {
  datosDelSiguienteSegmento,
  segmentoHandler,
  type WorkflowSegmentoInput,
} from "@/inngest/functions/workflow-segmento";
import {
  MARCA_PROFUNDIDAD_CADENA,
  MAX_PROFUNDIDAD_CADENA,
  MOTIVO_CADENA_CORTADA,
  MOTIVO_CADENA_CORTADA_AL_DESPERTAR,
  profundidadDeContexto,
} from "@/lib/workflows/cadena";
import type { DisparoWorkflow } from "@/lib/workflows/disparos";
import type { LogContext, Logger } from "@/lib/observability/logger";
import { InMemorySessionLock } from "@/server/lock/session-lock";
import {
  InMemoryLeadSessionRepository,
  type LeadSessionInsert,
} from "@/server/repositories/lead-session.repo";
import { InMemoryUsersRepository } from "@/server/repositories/users.repo";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { DefaultAsignacionService } from "@/server/services/asignacion/asignacion.service";
import { DefaultUsuariosService } from "@/server/services/usuarios/usuarios.service";
import {
  crearAccionesDeAsignacion,
  type AvisoVendedorAsignado,
} from "@/server/services/workflows/acciones/asignacion";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import type { UUID, WorkflowVersion } from "@/types/entities";
import type { Grafo, Nodo, NodoTipo } from "@/types/workflows";

/**
 * Un disparo que nace de una acción de otra corrida lleva la profundidad de la
 * cadena. Pasado `MAX_PROFUNDIDAD_CADENA` no arranca nada y deja la corrida
 * cancelada con el motivo: es lo que corta dos flujos "Vendedor asignado" que
 * se reasignan entre sí.
 */

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

function flujoQueReasigna(vendedorId: UUID): Grafo {
  return {
    nodos: [
      nodo("t", "trigger_vendedor_asignado"),
      nodo("a", "crm_vendedor", { vendedorId }),
      nodo("f", "logica_detener"),
    ],
    aristas: [
      { desde: "t", hasta: "a", puerto: "salida" },
      { desde: "a", hasta: "f", puerto: "salida" },
    ],
  };
}

function version(id: string, workflowId: string, grafo: Grafo): WorkflowVersion {
  return {
    id,
    workflow_id: workflowId,
    version: 1,
    grafo,
    max_pasos: 50,
    publicada: true,
    created_at: new Date("2026-09-25T10:00:00Z"),
    created_by: null,
    politica_concurrencia: "ignorar",
    nota: null,
  };
}

function nuevaSesion(leadId: UUID): LeadSessionInsert {
  return {
    lead_id: leadId,
    current_stage: "nuevo",
    urgencia: "media",
    consulta: "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
  };
}

/**
 * Las corridas que crea el repo, arrancadas o cortadas, leídas de vuelta. El
 * repo en memoria no lista todas: se anotan los ids que devuelve.
 */
function registrarCreadas(runs: InMemoryWorkflowRunsRepository) {
  const ids: UUID[] = [];
  const arrancar = runs.arrancar.bind(runs);
  const registrarNoArrancada = runs.registrarNoArrancada.bind(runs);
  runs.arrancar = async (input) => {
    const r = await arrancar(input);
    if (r.run) ids.push(r.run.id);
    return r;
  };
  runs.registrarNoArrancada = async (input, motivo) => {
    const r = await registrarNoArrancada(input, motivo);
    ids.push(r.id);
    return r;
  };
  return async () => {
    const todas = await Promise.all(ids.map((id) => runs.findRun(id)));
    return todas.filter((r) => r !== null);
  };
}

function loggerQueGuarda() {
  const lineas: { msg: string; ctx: LogContext }[] = [];
  const guardar = (msg: string, ctx?: LogContext) => lineas.push({ msg, ctx: ctx ?? {} });
  const logger: Logger = {
    debug: guardar,
    info: guardar,
    warn: guardar,
    error: guardar,
    child: () => logger,
  };
  return { logger, lineas };
}

describe("cadena de disparos entre flujos", () => {
  it("la profundidad se lee del contexto de la corrida; sin marca es 0", () => {
    expect(profundidadDeContexto({})).toBe(0);
    expect(profundidadDeContexto({ [MARCA_PROFUNDIDAD_CADENA]: 3 })).toBe(3);
    // Un valor que no es un entero no negativo no puede bajar la cuenta.
    expect(profundidadDeContexto({ [MARCA_PROFUNDIDAD_CADENA]: "9" })).toBe(0);
    expect(profundidadDeContexto({ [MARCA_PROFUNDIDAD_CADENA]: -2 })).toBe(0);
  });

  it("un disparo dentro del límite arranca y la corrida guarda su profundidad", async () => {
    const runs = new InMemoryWorkflowRunsRepository();
    const workflows = {
      listarPublicadasPorDisparador: async () => [version("v1", "w1", flujoQueReasigna("x"))],
    };

    const { iniciadas } = await arrancarPorDisparador(
      {
        disparador: "vendedor_asignado",
        leadId: "l1",
        contexto: { lead: { etapa: "nuevo" } },
        profundidad: MAX_PROFUNDIDAD_CADENA,
      },
      { runs, workflows },
    );

    expect(iniciadas).toHaveLength(1);
    const run = await runs.findRun(iniciadas[0]!.runId);
    expect(run?.contexto).toEqual({
      lead: { etapa: "nuevo" },
      [MARCA_PROFUNDIDAD_CADENA]: MAX_PROFUNDIDAD_CADENA,
    });
  });

  it("un disparo sin profundidad no le agrega nada al contexto", async () => {
    const arrancar = vi.fn(async () => ({
      run: null,
      motivo: "ya_hay_corrida_viva" as const,
      cancelados: [],
    }));
    await arrancarPorDisparador(
      { disparador: "vendedor_asignado", leadId: "l1", contexto: { x: 1 } },
      {
        runs: { arrancar, registrarNoArrancada: vi.fn() },
        workflows: {
          listarPublicadasPorDisparador: async () => [version("v1", "w1", flujoQueReasigna("x"))],
        },
      },
    );
    expect(arrancar).toHaveBeenCalledWith(expect.objectContaining({ contexto: { x: 1 } }));
  });

  it("pasado el límite no arranca: deja la corrida cancelada con el motivo y lo loguea", async () => {
    const runs = new InMemoryWorkflowRunsRepository();
    const arrancar = vi.spyOn(runs, "arrancar");
    const creadas = registrarCreadas(runs);
    const { logger, lineas } = loggerQueGuarda();

    const { iniciadas } = await arrancarPorDisparador(
      {
        disparador: "vendedor_asignado",
        leadId: "l1",
        leadSessionId: "s1",
        contexto: {},
        profundidad: MAX_PROFUNDIDAD_CADENA + 1,
      },
      {
        runs,
        workflows: {
          listarPublicadasPorDisparador: async () => [version("v1", "w1", flujoQueReasigna("x"))],
        },
        logger,
      },
    );

    expect(iniciadas).toEqual([]);
    expect(arrancar).not.toHaveBeenCalled();
    const cortadas = (await creadas()).filter((r) => r.estado === "cancelado");
    expect(cortadas).toHaveLength(1);
    expect(cortadas[0]).toMatchObject({
      workflow_version_id: "v1",
      lead_id: "l1",
      lead_session_id: "s1",
      pasos_ejecutados: 0,
      error: MOTIVO_CADENA_CORTADA,
    });
    expect(cortadas[0]!.ended_at).not.toBeNull();
    expect(lineas).toContainEqual({
      msg: "cadena-de-disparos-cortada",
      ctx: expect.objectContaining({ version_id: "v1", profundidad: MAX_PROFUNDIDAD_CADENA + 1 }),
    });
  });

  it("el aviso de una asignación sale con la profundidad de la corrida más uno", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const users = new InMemoryUsersRepository();
    const ana = (
      await users.create({ nombre: "Ana", email: "ana@crm.local", rol: "vendedor", activo: true })
    ).id;
    await sessions.create(nuevaSesion("l1"));
    const avisos: AvisoVendedorAsignado[] = [];
    const acciones = crearAccionesDeAsignacion({
      asignacion: new DefaultAsignacionService({
        sessions,
        usuarios: new DefaultUsuariosService({ users }),
      }),
      sessions,
      avisos: { vendedorAsignado: async (a) => void avisos.push(a) },
      candadoReparto: new InMemorySessionLock(),
    });

    await acciones.asignar_vendedor(nodo("a", "crm_vendedor", { vendedorId: ana }), {
      leadId: "l1",
      runId: "run-1",
      orden: 1,
      contexto: { [MARCA_PROFUNDIDAD_CADENA]: 2 },
    });

    expect(avisos.map((a) => a.profundidad)).toEqual([3]);
  });

  it("el disparo «vendedor asignado» lleva la profundidad del aviso", async () => {
    const emitidos: DisparoWorkflow[] = [];
    const sessions = new InMemoryLeadSessionRepository();
    const sesion = await sessions.create(nuevaSesion("l1"));

    await makeAvisosDeAsignacion(async (d) => void emitidos.push(d)).vendedorAsignado({
      leadId: "l1",
      sesion,
      vendedorId: "ven-1",
      runId: "run-1",
      orden: 1,
      profundidad: 4,
    });

    expect(emitidos[0]?.data.profundidad).toBe(4);
  });

  it("dos flujos que se reasignan entre sí terminan pasado el límite, con el motivo registrado", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const users = new InMemoryUsersRepository();
    const crear = async (nombre: string) =>
      (
        await users.create({
          nombre,
          email: `${nombre.toLowerCase()}@crm.local`,
          rol: "vendedor",
          activo: true,
        })
      ).id;
    const ana = await crear("Ana");
    const beto = await crear("Beto");
    const sesion = await sessions.create(nuevaSesion("l1"));

    // A le pasa el lead a Ana; B se lo pasa a Beto. Cada uno escucha
    // «vendedor asignado», así que cada reasignación arranca al otro.
    const versiones = [
      version("vA", "wA", flujoQueReasigna(ana)),
      version("vB", "wB", flujoQueReasigna(beto)),
    ];
    const workflowDe = new Map(versiones.map((v) => [v.id, v.workflow_id]));
    const runs = new InMemoryWorkflowRunsRepository((id) => workflowDe.get(id));
    const creadas = registrarCreadas(runs);
    const workflows = {
      listarPublicadasPorDisparador: async () => versiones,
      findVersion: async (id: string) => versiones.find((v) => v.id === id) ?? null,
    };

    const disparos: DisparoWorkflow[] = [];
    const registro = crearRegistro(
      crearAccionesDeAsignacion({
        asignacion: new DefaultAsignacionService({
          sessions,
          usuarios: new DefaultUsuariosService({ users }),
        }),
        sessions,
        avisos: makeAvisosDeAsignacion(async (d) => void disparos.push(d)),
        candadoReparto: new InMemorySessionLock(),
      }),
    );
    const segmentos: { runId: UUID; desdePaso: number }[] = [];

    // El primer disparo nace fuera del motor: una persona asigna desde el panel.
    disparos.push({
      id: "inicial",
      data: {
        disparador: "vendedor_asignado",
        leadId: "l1",
        leadSessionId: sesion.id,
        contexto: {},
      },
    });

    // Hace lo que Inngest: cada disparo arranca corridas, cada corrida corre su
    // segmento, y lo que emiten sus acciones vuelve a la cola. Sin el corte,
    // esta cola no se vacía nunca; el tope de vueltas es para que un bucle
    // falle el test en vez de colgarlo.
    let vueltas = 0;
    while ((disparos.length > 0 || segmentos.length > 0) && vueltas < 1000) {
      vueltas += 1;
      const disparo = disparos.shift();
      if (disparo) {
        await dispararHandler(disparo.data, {
          runs,
          workflows,
          emitir: async (s) => void segmentos.push(s),
          emitirCancelacion: async () => {},
        });
      }
      const segmento = segmentos.shift();
      if (segmento) await segmentoHandler(segmento, { runs, workflows, registro });
    }

    expect(vueltas).toBeLessThan(1000);
    const todas = await creadas();
    const arrancadas = todas.filter((r) => r.estado !== "cancelado");
    const cortadas = todas.filter((r) => r.estado === "cancelado");
    // Ninguna corrida pasó el límite, y el límite se alcanzó: el corte es
    // exactamente ahí y no antes.
    const profundidades = arrancadas.map((r) => profundidadDeContexto(r.contexto));
    expect(Math.max(...profundidades)).toBe(MAX_PROFUNDIDAD_CADENA);
    expect(arrancadas.every((r) => r.estado === "terminado")).toBe(true);
    // El salto que se cortó quedó a la vista, con el motivo.
    expect(cortadas.length).toBeGreaterThan(0);
    for (const r of cortadas) {
      expect(r.error).toBe(MOTIVO_CADENA_CORTADA);
      expect(profundidadDeContexto(r.contexto)).toBe(MAX_PROFUNDIDAD_CADENA + 1);
    }
  });
});

/**
 * Un flujo que despierta de «Esperar evento» sigue la cadena del evento que lo
 * despertó: sin esto, una corrida viva que espera un evento que emite otro
 * flujo sólo la frena `max_pasos`.
 */
describe("cadena de disparos — al despertar de «Esperar evento»", () => {
  const ESPERA_VENDEDOR = {
    evento: "vendedor_asignado",
    timeoutMax: 7,
    unidadTimeoutMax: "dias",
  };

  /** Asigna, espera «vendedor asignado» y vuelve a asignar: un ciclo con espera, legal. */
  function flujoQueEsperaYReasigna(vendedorId: UUID): Grafo {
    return {
      nodos: [
        nodo("t", "trigger_manual"),
        nodo("a", "crm_vendedor", { vendedorId }),
        nodo("w", "logica_esperar_evento", ESPERA_VENDEDOR),
      ],
      aristas: [
        { desde: "t", hasta: "a", puerto: "salida" },
        { desde: "a", hasta: "w", puerto: "salida" },
        { desde: "w", hasta: "a", puerto: "salida" },
      ],
    };
  }

  /** Una espera de evento que, al despertar, termina. */
  function grafoQueEspera(): Grafo {
    return {
      nodos: [nodo("w", "logica_esperar_evento", ESPERA_VENDEDOR), nodo("f", "logica_detener")],
      aristas: [{ desde: "w", hasta: "f", puerto: "salida" }],
    };
  }

  /** Dos esperas seguidas: al despertar de la primera, pausa en la segunda y persiste el contexto. */
  function grafoDeDosEsperas(): Grafo {
    return {
      nodos: [
        nodo("w", "logica_esperar_evento", ESPERA_VENDEDOR),
        nodo("w2", "logica_esperar_evento", ESPERA_VENDEDOR),
        nodo("f", "logica_detener"),
      ],
      aristas: [
        { desde: "w", hasta: "w2", puerto: "salida" },
        { desde: "w2", hasta: "f", puerto: "salida" },
      ],
    };
  }

  /**
   * Una corrida parada en la espera `w`, como la deja un segmento anterior:
   * reanuda en `reanudarEn`, el nodo que sigue a la espera.
   */
  async function corridaEsperando(
    runs: InMemoryWorkflowRunsRepository,
    leadId: UUID,
    reanudarEn: string,
    contexto: Record<string, unknown> = {},
  ): Promise<UUID> {
    const { run } = await runs.arrancar({ versionId: "v1", leadId, sessionId: null, contexto });
    await runs.esperar(run!.id, reanudarEn, contexto, 1);
    return run!.id;
  }

  const workflowsCon = (grafo: Grafo) => ({
    findVersion: async () => version("v1", "w1", grafo),
  });

  it("el siguiente segmento lleva la profundidad del evento que despertó la espera", () => {
    expect(
      datosDelSiguienteSegmento({
        runId: "r1",
        desdePaso: 3,
        respondio: false,
        despertadoPor: { data: { profundidad: 4 } },
      }),
    ).toEqual({ runId: "r1", desdePaso: 3, profundidad: 4 });
    // Venció por tiempo: no hay evento del que heredar.
    expect(
      datosDelSiguienteSegmento({
        runId: "r1",
        desdePaso: 3,
        respondio: false,
        despertadoPor: null,
      }),
    ).toEqual({ runId: "r1", desdePaso: 3 });
    // Lo despertó algo de afuera del motor (un mensaje): el evento no trae profundidad.
    expect(
      datosDelSiguienteSegmento({
        runId: "r1",
        desdePaso: 3,
        respondio: true,
        despertadoPor: { data: {} },
      }),
    ).toEqual({ runId: "r1", desdePaso: 3, respondio: true });
  });

  it("toma la mayor entre la suya y la del evento: nunca baja", async () => {
    const runs = new InMemoryWorkflowRunsRepository();
    const esperar = vi.spyOn(runs, "esperar");
    const deps = {
      runs,
      workflows: workflowsCon(grafoDeDosEsperas()),
      registro: crearRegistro({}),
    };

    // Profundidad 0 despertada por un evento de profundidad 4: lo que emita de
    // acá en más es un salto más de esa cadena.
    const baja = await corridaEsperando(runs, "l1", "w2");
    expect(
      await segmentoHandler({ runId: baja, desdePaso: 1, profundidad: 4 }, deps),
    ).toMatchObject({ tipo: "espera", nodoId: "w2" });
    expect(esperar).toHaveBeenLastCalledWith(
      baja,
      "f",
      { [MARCA_PROFUNDIDAD_CADENA]: 4 },
      expect.any(Number),
    );

    // Profundidad 3 despertada por un evento de profundidad 1: sigue en 3.
    const alta = await corridaEsperando(runs, "l2", "w2", { [MARCA_PROFUNDIDAD_CADENA]: 3 });
    await segmentoHandler({ runId: alta, desdePaso: 1, profundidad: 1 }, deps);
    expect(esperar).toHaveBeenLastCalledWith(
      alta,
      "f",
      { [MARCA_PROFUNDIDAD_CADENA]: 3 },
      expect.any(Number),
    );
  });

  it("despertada por un evento pasado el límite, se cancela con el motivo y no corre nada", async () => {
    const runs = new InMemoryWorkflowRunsRepository();
    const { logger, lineas } = loggerQueGuarda();
    const id = await corridaEsperando(runs, "l1", "f");
    const registrarPaso = vi.spyOn(runs, "registrarPaso");

    const r = await segmentoHandler(
      { runId: id, desdePaso: 1, profundidad: MAX_PROFUNDIDAD_CADENA + 1 },
      { runs, workflows: workflowsCon(grafoQueEspera()), registro: crearRegistro({}), logger },
    );

    expect(r).toEqual({ tipo: "cadena_cortada", profundidad: MAX_PROFUNDIDAD_CADENA + 1 });
    expect(await runs.findRun(id)).toMatchObject({
      estado: "cancelado",
      error: MOTIVO_CADENA_CORTADA_AL_DESPERTAR,
      pasos_ejecutados: 1,
    });
    expect(registrarPaso).not.toHaveBeenCalled();
    expect(lineas).toContainEqual({
      msg: "cadena-de-disparos-cortada",
      ctx: expect.objectContaining({ profundidad: MAX_PROFUNDIDAD_CADENA + 1 }),
    });
  });

  it("dos flujos, uno espera el evento que emite el otro: se cortan en el límite", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const users = new InMemoryUsersRepository();
    const crear = async (nombre: string) =>
      (
        await users.create({
          nombre,
          email: `${nombre.toLowerCase()}@crm.local`,
          rol: "vendedor",
          activo: true,
        })
      ).id;
    const ana = await crear("Ana");
    const beto = await crear("Beto");
    const sesion = await sessions.create(nuevaSesion("l1"));

    // A (manual) le pasa el lead a Ana y espera «vendedor asignado»; al
    // despertar se lo vuelve a pasar a Ana y vuelve a esperar. B escucha
    // «vendedor asignado» y se lo pasa a Beto, lo que despierta a A.
    // `max_pasos` alto a propósito: lo que tiene que cortar es la cadena.
    const versiones = [
      { ...version("vA", "wA", flujoQueEsperaYReasigna(ana)), max_pasos: 10_000 },
      version("vB", "wB", flujoQueReasigna(beto)),
    ];
    const workflowDe = new Map(versiones.map((v) => [v.id, v.workflow_id]));
    const runs = new InMemoryWorkflowRunsRepository((id) => workflowDe.get(id));
    const creadas = registrarCreadas(runs);
    const workflows = {
      listarPublicadasPorDisparador: async (disparador: string) =>
        versiones.filter((v) => (disparador === "manual" ? v.id === "vA" : v.id === "vB")),
      findVersion: async (id: string) => versiones.find((v) => v.id === id) ?? null,
    };

    // Cada disparo lleva el orden en que se emitió: una espera sólo la
    // despiertan los que llegan después de registrarse, como `step.waitForEvent`.
    const disparos: (DisparoWorkflow & { orden: number })[] = [];
    let emitidos = 0;
    const emitir = (d: DisparoWorkflow) => void disparos.push({ ...d, orden: emitidos++ });
    const registro = crearRegistro(
      crearAccionesDeAsignacion({
        asignacion: new DefaultAsignacionService({
          sessions,
          usuarios: new DefaultUsuariosService({ users }),
        }),
        sessions,
        avisos: makeAvisosDeAsignacion(async (d) => emitir(d)),
        candadoReparto: new InMemorySessionLock(),
      }),
    );
    const segmentos: WorkflowSegmentoInput[] = [];
    const esperas: {
      runId: UUID;
      desdePaso: number;
      leadId: UUID;
      disparador: string;
      desdeOrden: number;
    }[] = [];

    emitir({
      id: "inicial",
      data: {
        disparador: "manual",
        workflowId: "wA",
        leadId: "l1",
        leadSessionId: sesion.id,
        contexto: {},
      },
    });

    // Hace lo que Inngest: cada disparo despierta las esperas que coinciden y
    // arranca corridas; cada segmento corre y, si queda esperando un evento,
    // se anota. El tope de vueltas es para que un bucle falle el test en vez
    // de colgarlo.
    let vueltas = 0;
    while ((disparos.length > 0 || segmentos.length > 0) && vueltas < 1000) {
      vueltas += 1;
      const disparo = disparos.shift();
      if (disparo) {
        for (const espera of [...esperas]) {
          if (
            espera.leadId === disparo.data.leadId &&
            espera.disparador === disparo.data.disparador &&
            disparo.orden >= espera.desdeOrden
          ) {
            esperas.splice(esperas.indexOf(espera), 1);
            segmentos.push(
              datosDelSiguienteSegmento({
                runId: espera.runId,
                desdePaso: espera.desdePaso,
                respondio: false,
                despertadoPor: disparo,
              }),
            );
          }
        }
        await dispararHandler(disparo.data, {
          runs,
          workflows,
          emitir: async (s) => void segmentos.push(s),
          emitirCancelacion: async () => {},
        });
      }
      const segmento = segmentos.shift();
      if (segmento) {
        const r = await segmentoHandler(segmento, { runs, workflows, registro });
        if (r.tipo === "espera" && r.esperaEvento) {
          esperas.push({
            runId: segmento.runId,
            desdePaso: r.desdePaso,
            leadId: r.esperaEvento.leadId,
            disparador: r.esperaEvento.disparador,
            desdeOrden: emitidos,
          });
        }
      }
    }

    expect(vueltas).toBeLessThan(1000);
    const todas = await creadas();
    const deA = todas.filter((r) => r.workflow_version_id === "vA");
    const deB = todas.filter((r) => r.workflow_version_id === "vB");
    // A arrancó una sola vez y la cortó la cadena al despertar, no `max_pasos`.
    expect(deA).toHaveLength(1);
    expect(deA[0]).toMatchObject({
      estado: "cancelado",
      error: MOTIVO_CADENA_CORTADA_AL_DESPERTAR,
    });
    // Ninguna corrida de B pasó el límite, y el límite se alcanzó.
    const arrancadasB = deB.filter((r) => r.estado !== "cancelado");
    expect(arrancadasB.every((r) => r.estado === "terminado")).toBe(true);
    expect(Math.max(...arrancadasB.map((r) => profundidadDeContexto(r.contexto)))).toBe(
      MAX_PROFUNDIDAD_CADENA,
    );
    // Los eventos pasados del límite que habrían arrancado otra B: también
    // cortados, con el motivo de los disparos.
    const cortadasB = deB.filter((r) => r.estado === "cancelado");
    expect(cortadasB.length).toBeGreaterThan(0);
    for (const r of cortadasB) {
      expect(r.error).toBe(MOTIVO_CADENA_CORTADA);
      expect(profundidadDeContexto(r.contexto)).toBe(MAX_PROFUNDIDAD_CADENA + 1);
    }
  });
});
