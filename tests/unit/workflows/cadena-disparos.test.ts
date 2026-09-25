import { describe, expect, it, vi } from "vitest";
import { makeAvisosDeAsignacion } from "@/inngest/callbacks/workflow-adapters";
import { arrancarPorDisparador, dispararHandler } from "@/inngest/functions/workflow-disparar";
import { segmentoHandler } from "@/inngest/functions/workflow-segmento";
import {
  MARCA_PROFUNDIDAD_CADENA,
  MAX_PROFUNDIDAD_CADENA,
  MOTIVO_CADENA_CORTADA,
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

    const iniciadas = await arrancarPorDisparador(
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
    const arrancar = vi.fn(async () => ({ run: null, motivo: "ya_hay_corrida_viva" as const }));
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

    const iniciadas = await arrancarPorDisparador(
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
