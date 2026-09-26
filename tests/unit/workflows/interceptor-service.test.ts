import { describe, expect, test } from "vitest";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { InMemoryTurnosInterceptadosRepository } from "@/server/repositories/turnos-interceptados.repo";
import {
  InterceptorTurnoService,
  type DecidirIntercepcionInput,
} from "@/server/services/workflows/interceptor.service";
import { marcarEsperaDeOpcion } from "@/lib/workflows/respuesta-interactiva";
import type { WorkflowVersion } from "@/types/entities";
import type { Grafo, Nodo } from "@/types/workflows";

const nodo = (id: string, tipo: Nodo["tipo"], config: Record<string, unknown> = {}): Nodo => ({
  id,
  tipo,
  config,
  posicion: { x: 0, y: 0 },
});

const regla = (campoId: string, comparador: string, valor: unknown) => ({
  arbol: {
    id: "raiz",
    clase: "grupo",
    operador: "y",
    hijos: [{ id: "f1", clase: "regla", campoId, comparador, valor }],
  },
});

function responder(trigger: Record<string, unknown>, condicion: Record<string, unknown>): Grafo {
  return {
    nodos: [
      nodo("t", "trigger_mensaje", trigger),
      nodo("c", "logica_condicion", condicion),
      nodo("m", "msg_texto", { mensaje: "respuesta del flujo" }),
      nodo("d", "logica_detener"),
      nodo("d2", "logica_detener"),
    ],
    aristas: [
      { desde: "t", hasta: "c", puerto: "salida" },
      { desde: "c", hasta: "m", puerto: "verdadero" },
      { desde: "c", hasta: "d", puerto: "falso" },
      { desde: "m", hasta: "d2", puerto: "salida" },
    ],
  };
}

function version(
  workflowId: string,
  grafo: Grafo,
  creada = "2026-09-01T00:00:00Z",
): WorkflowVersion {
  return {
    id: `v-${workflowId}`,
    workflow_id: workflowId,
    version: 1,
    grafo,
    max_pasos: 50,
    publicada: true,
    created_at: new Date(creada),
    created_by: null,
    politica_concurrencia: "ignorar",
    nota: null,
  };
}

const LEAD = "00000000-0000-4000-8000-000000000001";
const SESION = "00000000-0000-4000-8000-000000000002";

function input(overrides: Partial<DecidirIntercepcionInput> = {}): DecidirIntercepcionInput {
  return {
    leadId: LEAD,
    leadSessionId: SESION,
    datos: { canal: "wa", tipoMensaje: "text", texto: "¿a qué hora abren?" },
    contexto: { lead: { canal: "wa" }, sesion: { respondio: true } },
    intentConocido: false,
    respuestaInteractiva: null,
    ...overrides,
  };
}

/** Lo que miran los topes del envío. Por defecto: nada impide mandar. */
interface EstadoLead {
  salientes?: number;
  bajas?: string[];
  etapa?: string;
  ultimoEntrante?: Date | null;
  /** El sábado (el día de `AHORA`) sin horario de atención; el resto abierto. */
  cerradoHoy?: boolean;
}

const AHORA = new Date("2026-09-26T15:00:00Z");
const TODO_EL_DIA = [{ desde: "00:00", hasta: "23:59" }];

function puertosDeTopes(estado: EstadoLead = {}) {
  return {
    topes: {
      sessions: {
        findById: async () => null,
        findActiveByLeadId: async () =>
          ({ id: SESION, current_stage: estado.etapa ?? "considerando" }) as never,
      },
      leads: { findById: async () => ({ id: LEAD, telefono: "+593990001771" }) as never },
      supresiones: {
        activasPorTelefonos: async (tels: readonly string[]) =>
          (estado.bajas ?? [])
            .filter((b) => tels.includes(b))
            .map((telefono) => ({ id: "b", telefono })) as never,
      },
      configProvider: {
        activa: async () => ({
          max_salientes_automaticos_24h: 3,
          horario: {
            lun: TODO_EL_DIA,
            mar: TODO_EL_DIA,
            mie: TODO_EL_DIA,
            jue: TODO_EL_DIA,
            vie: TODO_EL_DIA,
            sab: estado.cerradoHoy ? [] : TODO_EL_DIA,
            dom: TODO_EL_DIA,
          },
          horario_timezone: "UTC",
        }),
      },
      messages: { contarSalientesAutomaticos: async () => estado.salientes ?? 0 },
      plantillasSinSesion: { contarNoAnotadasDesde: async () => 0 },
    },
    conversations: {
      findActivaByLead: async () => ({
        id: "c1",
        canal: "wa" as const,
        ultimo_entrante_at:
          estado.ultimoEntrante === undefined
            ? new Date("2026-09-26T14:59:00Z")
            : estado.ultimoEntrante,
      }),
    },
  };
}

function servicio(
  versiones: WorkflowVersion[],
  runs = new InMemoryWorkflowRunsRepository(),
  estado: EstadoLead = {},
) {
  const turnos = new InMemoryTurnosInterceptadosRepository();
  const cargas: string[][] = [];
  const svc = new InterceptorTurnoService({
    ...puertosDeTopes(estado),
    workflows: { listarPublicadasPorDisparador: async () => versiones },
    runs,
    turnos,
    camposVivos: {
      cargar: async (consulta) => {
        cargas.push([...consulta.campos]);
        return { lead: { etiquetas: ["tag-mayorista"] } };
      },
      zona: async () => "America/Lima",
    },
    ahora: () => AHORA,
  });
  return { svc, turnos, cargas };
}

const PALABRA = { interceptaLlm: true, filtro: "contiene", palabra: "hora" };

describe("InterceptorTurnoService.decidir — condición del flujo", () => {
  test("el mensaje cumple la condición: intercepta el flujo marcado", async () => {
    const { svc } = servicio([
      version(
        "wf-a",
        responder(PALABRA, regla("lead.canal", "es", { tipo: "opcion", valor: "wa" })),
      ),
    ]);
    expect(await svc.decidir(input())).toEqual({
      tipo: "intercepta",
      motivo: "condicion",
      workflowId: "wf-a",
      versionId: "v-wf-a",
    });
  });

  test("el mensaje no cumple el filtro del trigger: no intercepta", async () => {
    const { svc } = servicio([
      version(
        "wf-a",
        responder(PALABRA, regla("lead.canal", "es", { tipo: "opcion", valor: "wa" })),
      ),
    ]);
    expect(
      await svc.decidir(input({ datos: { canal: "wa", tipoMensaje: "text", texto: "precio?" } })),
    ).toEqual({ tipo: "no" });
  });

  test("un flujo sin la marca no intercepta aunque coincida", async () => {
    const { svc } = servicio([
      version(
        "wf-a",
        responder({ filtro: "todos" }, regla("lead.canal", "es", { tipo: "opcion", valor: "wa" })),
      ),
    ]);
    expect(await svc.decidir(input())).toEqual({ tipo: "no" });
  });

  test("la condición mira el intent y el turno no se clasificó: lo pide", async () => {
    const { svc } = servicio([
      version(
        "wf-a",
        responder(
          { interceptaLlm: true },
          regla("sesion.intent", "es", { tipo: "opcion", valor: "i-horario" }),
        ),
      ),
    ]);
    expect(await svc.decidir(input())).toEqual({ tipo: "necesita_intent" });
    expect(
      await svc.decidir(
        input({ intentConocido: true, contexto: { sesion: { intent: "i-horario" } } }),
      ),
    ).toMatchObject({ tipo: "intercepta", workflowId: "wf-a" });
  });

  test("lee de la base sólo los campos vivos que usa el prefijo", async () => {
    const { svc, cargas } = servicio([
      version(
        "wf-a",
        responder(
          { interceptaLlm: true },
          regla("lead.etiquetas", "tiene", { tipo: "opciones", valores: ["tag-mayorista"] }),
        ),
      ),
    ]);
    expect(await svc.decidir(input())).toMatchObject({ tipo: "intercepta" });
    expect(cargas).toEqual([["lead.etiquetas"]]);
  });

  test("varios interceptores coinciden: gana el publicado hace más tiempo", async () => {
    const siempre = regla("lead.canal", "es", { tipo: "opcion", valor: "wa" });
    const { svc } = servicio([
      version("wf-nuevo", responder({ interceptaLlm: true }, siempre), "2026-09-20T00:00:00Z"),
      version("wf-viejo", responder({ interceptaLlm: true }, siempre), "2026-09-02T00:00:00Z"),
    ]);
    expect(await svc.decidir(input())).toMatchObject({ workflowId: "wf-viejo" });
  });
});

describe("InterceptorTurnoService.decidir — botón que una corrida espera", () => {
  test("el toque responde al mensaje que la corrida espera: intercepta con la corrida", async () => {
    const runs = new InMemoryWorkflowRunsRepository(() => "wf-botones");
    const { run } = await runs.arrancar({
      versionId: "v-botones",
      leadId: LEAD,
      sessionId: SESION,
      contexto: {},
    });
    await runs.esperar(run!.id, "botones", marcarEsperaDeOpcion("botones", "wamid.OUT-1"), 2);
    const { svc } = servicio([], runs);

    expect(
      await svc.decidir(input({ respuestaInteractiva: { respondeA: "wamid.OUT-1" } })),
    ).toEqual({
      tipo: "intercepta",
      motivo: "respuesta_esperada",
      workflowId: "wf-botones",
      runId: run!.id,
    });
  });

  test("un toque a otro mensaje no es de esa corrida: el agente sigue", async () => {
    const runs = new InMemoryWorkflowRunsRepository(() => "wf-botones");
    const { run } = await runs.arrancar({
      versionId: "v-botones",
      leadId: LEAD,
      sessionId: SESION,
      contexto: {},
    });
    await runs.esperar(run!.id, "botones", marcarEsperaDeOpcion("botones", "wamid.OUT-1"), 2);
    const { svc } = servicio([], runs);

    expect(await svc.decidir(input({ respuestaInteractiva: { respondeA: "wamid.OTRO" } }))).toEqual(
      { tipo: "no" },
    );
  });
});

describe("InterceptorTurnoService.registrar", () => {
  test("anota el turno una sola vez aunque el step se reintente", async () => {
    const { svc, turnos } = servicio([]);
    const decision = {
      tipo: "intercepta",
      motivo: "condicion",
      workflowId: "wf-a",
      versionId: "v-wf-a",
    } as const;
    await svc.registrar("m-1", decision);
    await svc.registrar("m-1", decision);
    const filas = await turnos.listByMensajeIds(["m-1"]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      workflow_id: "wf-a",
      workflow_version_id: "v-wf-a",
      workflow_run_id: null,
      motivo: "condicion",
    });
  });
});

/**
 * La regla del dueño: nunca se silencia al agente si el flujo no va a poder
 * responder. El interceptor mira los mismos topes que va a aplicar el envío
 * (`topes-de-envio.ts`) y, si alguno lo impide, contesta el agente.
 */
describe("InterceptorTurnoService.decidir — el flujo tiene que poder responder", () => {
  const siempre = regla("lead.canal", "es", { tipo: "opcion", valor: "wa" });
  const interceptor = () => version("wf-a", responder(PALABRA, siempre));

  test("tope de frecuencia lleno: no intercepta y dice por qué", async () => {
    const { svc } = servicio([interceptor()], undefined, { salientes: 3 });
    expect(await svc.decidir(input())).toEqual({
      tipo: "no",
      descartada: { workflowId: "wf-a", motivo: "tope_frecuencia" },
    });
  });

  test("lead dado de baja: no intercepta", async () => {
    const { svc } = servicio([interceptor()], undefined, { bajas: ["593990001771"] });
    expect(await svc.decidir(input())).toMatchObject({
      tipo: "no",
      descartada: { motivo: "dado_de_baja" },
    });
  });

  test("lead en requiere humano: no intercepta", async () => {
    const { svc } = servicio([interceptor()], undefined, { etapa: "requiere_humano" });
    expect(await svc.decidir(input())).toMatchObject({
      tipo: "no",
      descartada: { motivo: "requiere_humano" },
    });
  });

  test("ventana cerrada y el primer bloque es texto libre: no intercepta", async () => {
    const { svc } = servicio([interceptor()], undefined, { ultimoEntrante: null });
    expect(await svc.decidir(input())).toMatchObject({
      tipo: "no",
      descartada: { motivo: "sin_ventana" },
    });
  });

  test("ventana cerrada y el primer bloque es una plantilla: intercepta", async () => {
    const grafo = responder(PALABRA, siempre);
    grafo.nodos = grafo.nodos.map((n) =>
      n.id === "m"
        ? nodo("m", "msg_plantilla", { templateName: "horario", idioma: "es", parametros: [] })
        : n,
    );
    const { svc } = servicio([version("wf-a", grafo)], undefined, { ultimoEntrante: null });
    expect(await svc.decidir(input())).toMatchObject({ tipo: "intercepta", workflowId: "wf-a" });
  });

  test("el primer envío viene después de otro bloque: se mira ese envío", async () => {
    const grafo: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje", PALABRA),
        nodo("a", "int_notif_vendedor", { destinatario: "vendedor_asignado", mensaje: "ojo" }),
        nodo("m", "msg_texto", { mensaje: "respuesta" }),
        nodo("d", "logica_detener"),
      ],
      aristas: [
        { desde: "t", hasta: "a", puerto: "salida" },
        { desde: "a", hasta: "m", puerto: "salida" },
        { desde: "m", hasta: "d", puerto: "salida" },
      ],
    };
    const { svc } = servicio([version("wf-a", grafo)], undefined, { ultimoEntrante: null });
    expect(await svc.decidir(input())).toMatchObject({
      tipo: "no",
      descartada: { motivo: "sin_ventana" },
    });
  });

  test("el bloque que contestaría está mal configurado: no intercepta", async () => {
    const grafo = responder(PALABRA, siempre);
    grafo.nodos = grafo.nodos.map((n) => (n.id === "m" ? nodo("m", "msg_texto", {}) : n));
    const { svc } = servicio([version("wf-a", grafo)]);
    expect(await svc.decidir(input())).toMatchObject({
      tipo: "no",
      descartada: { motivo: "bloque_mal_configurado" },
    });
  });

  test("el toque de un botón esperado con el tope lleno: contesta el agente", async () => {
    const runs = new InMemoryWorkflowRunsRepository(() => "wf-botones");
    const { run } = await runs.arrancar({
      versionId: "v-botones",
      leadId: LEAD,
      sessionId: SESION,
      contexto: {},
    });
    await runs.esperar(run!.id, "botones", marcarEsperaDeOpcion("botones", "wamid.OUT-1"), 2);
    const { svc } = servicio([], runs, { salientes: 3 });
    expect(
      await svc.decidir(input({ respuestaInteractiva: { respondeA: "wamid.OUT-1" } })),
    ).toMatchObject({
      tipo: "no",
      descartada: { workflowId: "wf-botones", motivo: "tope_frecuencia" },
    });
  });
});

describe("InterceptorTurnoService.decidir — la corrida tiene que poder arrancar y mandar ya", () => {
  const siempre = regla("lead.canal", "es", { tipo: "opcion", valor: "wa" });

  async function conCorridaViva(workflowId: string) {
    const runs = new InMemoryWorkflowRunsRepository((v) => v.replace(/^v-/, ""));
    await runs.arrancar({
      versionId: `v-${workflowId}`,
      leadId: LEAD,
      sessionId: SESION,
      contexto: {},
    });
    return runs;
  }

  test("política ignorar con una corrida viva del flujo: no arranca, no intercepta", async () => {
    const runs = await conCorridaViva("wf-a");
    const { svc } = servicio([version("wf-a", responder(PALABRA, siempre))], runs);
    expect(await svc.decidir(input())).toEqual({
      tipo: "no",
      descartada: { workflowId: "wf-a", motivo: "ya_hay_corrida_viva" },
    });
  });

  test("política reiniciar con una corrida viva: la nueva arranca, intercepta", async () => {
    const runs = await conCorridaViva("wf-a");
    const { svc } = servicio(
      [{ ...version("wf-a", responder(PALABRA, siempre)), politica_concurrencia: "reiniciar" }],
      runs,
    );
    expect(await svc.decidir(input())).toMatchObject({ tipo: "intercepta", workflowId: "wf-a" });
  });

  test("la corrida viva de Probar no cuenta", async () => {
    const runs = new InMemoryWorkflowRunsRepository((v) => v.replace(/^v-/, ""));
    await runs.arrancar({
      versionId: "v-wf-a",
      leadId: LEAD,
      sessionId: SESION,
      contexto: { $prueba: true },
    });
    const { svc } = servicio([version("wf-a", responder(PALABRA, siempre))], runs);
    expect(await svc.decidir(input())).toMatchObject({ tipo: "intercepta" });
  });

  test("fuera de horario no intercepta: el envío se diferiría", async () => {
    const { svc } = servicio([version("wf-a", responder(PALABRA, siempre))], undefined, {
      cerradoHoy: true,
    });
    expect(await svc.decidir(input())).toEqual({
      tipo: "no",
      descartada: { workflowId: "wf-a", motivo: "fuera_de_horario" },
    });
  });
});
