import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { InMemoryTurnosInterceptadosRepository } from "@/server/repositories/turnos-interceptados.repo";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { InterceptorTurnoService } from "@/server/services/workflows/interceptor.service";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { marcarEsperaDeOpcion } from "@/lib/workflows/respuesta-interactiva";
import { makeConversationsParaEnviarMensaje } from "@/inngest/callbacks/workflow-adapters";
import {
  onMessageReceivedHandler,
  type EmittedEvent,
  type OnMessageReceivedDeps,
} from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import type { WorkflowVersion } from "@/types/entities";
import type { Grafo, Nodo } from "@/types/workflows";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

/**
 * Decisión 2 del dueño: un flujo marcado "intercepta el LLM" contesta en lugar
 * del agente cuando el mensaje cumple su condición; y el toque de un botón que
 * una corrida espera tampoco lo contesta el agente.
 */

type Disparo = Extract<EmittedEvent, { name: "workflow/disparo.recibido" }>;

const nodo = (id: string, tipo: Nodo["tipo"], config: Record<string, unknown> = {}): Nodo => ({
  id,
  tipo,
  config,
  posicion: { x: 0, y: 0 },
});

/** Mensaje recibido (contiene "horario") → Condición → (sí) Enviar · (no) Detener. */
function responderHorario(condicion: Record<string, unknown>): Grafo {
  return {
    nodos: [
      nodo("t", "trigger_mensaje", { interceptaLlm: true, filtro: "contiene", palabra: "horario" }),
      nodo("c", "logica_condicion", condicion),
      nodo("m", "msg_texto", { mensaje: "Abrimos de 9 a 18" }),
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

const regla = (campoId: string, valor: string) => ({
  arbol: {
    id: "raiz",
    clase: "grupo",
    operador: "y",
    hijos: [
      { id: "f1", clase: "regla", campoId, comparador: "es", valor: { tipo: "opcion", valor } },
    ],
  },
});

function version(grafo: Grafo): WorkflowVersion {
  return {
    id: "v-horario",
    workflow_id: "wf-horario",
    version: 1,
    grafo,
    max_pasos: 50,
    publicada: true,
    created_at: new Date("2026-09-01T00:00:00Z"),
    created_by: null,
    politica_concurrencia: "ignorar",
    nota: null,
  };
}

function parsed(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    canal_thread_id: "549110",
    meta_user_id: "549110",
    meta_message_id: "wamid.IN-1",
    tipo: "text",
    contenido: "¿cuál es el horario?",
    media_url: null,
    nombre_perfil: "Ana",
    raw: { type: "text" },
    ...overrides,
  };
}

/** El tope de frecuencia de la config de los envíos de flujos. */
const TOPE = 3;

function makeDeps(versiones: WorkflowVersion[] = []) {
  const leads = new InMemoryLeadsRepository();
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const tags = new InMemoryTagsRepository();
  const runs = new InMemoryWorkflowRunsRepository(() => "wf-botones");
  const turnos = new InMemoryTurnosInterceptadosRepository();

  const intentLLM = new FakeIntentClassifierLLM();
  const agentLLM = new FakeAgentLLM();
  const metaApi = new DefaultMetaApiService(conversations, messages, new FakeMetaApiClient());
  const reglasEtiqueta = new InMemoryReglasEtiquetaRepository();
  const ruleEngine = new DefaultRuleEngineService(intents, rules, reglasEtiqueta);
  const supresiones = new InMemoryDifusionSupresionesRepository();
  const aiAgent = new DefaultAiAgentService(
    sessions,
    ruleEngine,
    new DefaultCatalogMatcherService(new InMemoryProductsRepository()),
    agentLLM,
  );
  // Los mismos puertos con que `bootstrap.ts` arma los topes de los envíos.
  const puertosDeTopes = {
    topes: {
      sessions,
      leads,
      supresiones,
      // El InMemory cuenta por sesión si no le dicen de qué lead es cada
      // mensaje (ver su constructor): se le pasa la sesión activa del lead.
      messages: {
        contarSalientesAutomaticos: async (leadId: string, desde: Date) => {
          const sesion = await sessions.findActiveByLeadId(leadId);
          return sesion ? messages.contarSalientesAutomaticos(sesion.id, desde) : 0;
        },
      },
      plantillasSinSesion: { contarNoAnotadasDesde: async () => 0 },
      configProvider: {
        activa: async () => ({ ...CONFIG_DE_FABRICA, max_salientes_automaticos_24h: TOPE }),
      },
    },
    conversations: makeConversationsParaEnviarMensaje({ conversations, messages }),
  };
  const nuevoInterceptor = (vs: WorkflowVersion[]) =>
    new InterceptorTurnoService({
      workflows: { listarPublicadasPorDisparador: async () => vs },
      runs,
      turnos,
      camposVivos: { cargar: async () => ({}), zona: async () => "UTC" },
      ...puertosDeTopes,
    });
  const interceptor = nuevoInterceptor(versiones);

  const emitted: EmittedEvent[] = [];
  const deps: OnMessageReceivedDeps = {
    leads,
    conversations,
    sessions,
    messages,
    metaApi,
    intentClassifier: new DefaultIntentClassifierService(intents, intentLLM),
    aiAgent,
    ruleExecutions: new InMemoryRuleExecutionsRepository(),
    turnClassifications: new InMemoryTurnClassificationsRepository(),
    ruleEngine,
    tags,
    intents,
    identificadores: new InMemoryLeadIdentificadoresRepository(),
    supresiones,
    respuestaDifusion: { registrar: async () => null },
    plantillasSinSesion: { registrar: async () => 0 },
    interceptor,
    configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
    emit: async (e) => {
      emitted.push(e);
    },
  };
  return {
    deps,
    emitted,
    intentLLM,
    agentLLM,
    intents,
    messages,
    runs,
    turnos,
    leads,
    tags,
    reglasEtiqueta,
    nuevoInterceptor,
  };
}

const disparosMensaje = (emitted: EmittedEvent[]): Disparo[] =>
  emitted.filter(
    (e): e is Disparo =>
      e.name === "workflow/disparo.recibido" && e.data.disparador === "mensaje_recibido",
  );

describe("on-message-received — el flujo intercepta el LLM", () => {
  let ctx: ReturnType<typeof makeDeps>;

  describe("con una condición que no mira el intent", () => {
    beforeEach(() => {
      ctx = makeDeps([version(responderHorario(regla("lead.canal", "wa")))]);
    });

    test("se cumple: clasifica pero no contesta el agente; el flujo arranca y el turno queda anotado", async () => {
      // Sin intents activos el clasificador ni llama al LLM: hace falta uno.
      await ctx.intents.create({
        nombre: "horario",
        descripcion: "pregunta por el horario",
        ejemplos: [],
        auto_detectado: false,
        activo: true,
      });
      ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
      const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

      // Lo que se ahorra al interceptar es la respuesta del agente, no la
      // clasificación (decisión del dueño): las etiquetas y los demás flujos
      // necesitan el intent del turno.
      expect(ctx.intentLLM.calls).toHaveLength(1);
      expect(ctx.agentLLM.calls).toHaveLength(0);
      expect(r.agentSource).toBe("flujo");
      expect(r.sent).toBe(false);

      const [disparo] = disparosMensaje(ctx.emitted);
      expect(disparo?.data.interceptadoPor).toBe("wf-horario");

      const mensajes = await ctx.messages.listByConversacion(r.conversacionId);
      expect(mensajes.filter((m) => m.direction === "out")).toHaveLength(0);
      const entrante = mensajes.find((m) => m.direction === "in")!;
      expect(await ctx.turnos.listByMensajeIds([entrante.id])).toMatchObject([
        { workflow_id: "wf-horario", workflow_version_id: "v-horario", motivo: "condicion" },
      ]);
      // Sin respuesta del agente no hay turno que extraer al Twin (otra llamada al LLM).
      expect(ctx.emitted.some((e) => e.name === "lead-session/turn.completed")).toBe(false);
    });

    test("no se cumple el filtro del trigger: contesta el agente", async () => {
      ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
      ctx.agentLLM.enqueueText("¡Hola! ¿En qué te ayudo?");

      const r = await onMessageReceivedHandler(
        { parsed: parsed({ contenido: "¿tienen pastillas de freno?" }) },
        ctx.deps,
      );

      expect(ctx.agentLLM.calls).toHaveLength(1);
      expect(r.agentSource).toBe("llm");
      expect(r.sent).toBe(true);
      expect(disparosMensaje(ctx.emitted)[0]?.data.interceptadoPor).toBeUndefined();
    });
  });

  test("la condición no se cumple: contesta el agente", async () => {
    ctx = makeDeps([version(responderHorario(regla("lead.canal", "ig")))]);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Abrimos de 9 a 18, ¿algo más?");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.agentLLM.calls).toHaveLength(1);
    expect(r.agentSource).toBe("llm");
  });

  test("la condición mira el intent: clasifica, intercepta y no llama al agente", async () => {
    ctx = makeDeps([]);
    const intent = await ctx.intents.create({
      nombre: "horario",
      descripcion: "pregunta por el horario",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    ctx.deps.interceptor = ctx.nuevoInterceptor([
      version(responderHorario(regla("sesion.intent", intent.id))),
    ]);
    ctx.intentLLM.enqueue({ intent_nombre: "horario", confidence: 0.9 });

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.intentLLM.calls).toHaveLength(1);
    expect(ctx.agentLLM.calls).toHaveLength(0);
    expect(r.agentSource).toBe("flujo");
    expect(disparosMensaje(ctx.emitted)[0]?.data.interceptadoPor).toBe("wf-horario");
  });
});

describe("on-message-received — el turno interceptado se clasifica igual", () => {
  let ctx: ReturnType<typeof makeDeps>;

  async function intentHorarioConEtiqueta() {
    const intent = await ctx.intents.create({
      nombre: "horario",
      descripcion: "pregunta por el horario",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    const tag = await ctx.tags.create({
      nombre: "Pregunta horario",
      color: "#336699",
      descripcion: null,
    });
    await ctx.reglasEtiqueta.create({
      intent_id: intent.id,
      tag_id: tag.id,
      condiciones_extra: null,
      activa: true,
    });
    return { intent, tag };
  }

  beforeEach(() => {
    ctx = makeDeps([version(responderHorario(regla("lead.canal", "wa")))]);
  });

  test("un turno interceptado etiqueta como uno normal", async () => {
    const { tag } = await intentHorarioConEtiqueta();
    ctx.intentLLM.enqueue({ intent_nombre: "horario", confidence: 0.9 });

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(r.agentSource).toBe("flujo");
    expect(ctx.agentLLM.calls).toHaveLength(0);
    expect((await ctx.tags.listByLead(r.leadId)).map((t) => t.id)).toEqual([tag.id]);
    // Y el flujo con trigger «Etiqueta asignada» se entera, como en un turno normal.
    expect(
      ctx.emitted.some(
        (e) => e.name === "workflow/disparo.recibido" && e.data.disparador === "etiqueta_asignada",
      ),
    ).toBe(true);
  });

  test("los otros flujos del mensaje reciben el intent del turno", async () => {
    const { intent } = await intentHorarioConEtiqueta();
    ctx.intentLLM.enqueue({ intent_nombre: "horario", confidence: 0.9 });

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const [disparo] = disparosMensaje(ctx.emitted);
    expect(disparo?.data.interceptadoPor).toBe("wf-horario");
    expect(disparo?.data.contexto["sesion"]).toMatchObject({ intent: intent.id });
    expect(disparosMensaje(ctx.emitted)).toHaveLength(1);
  });

  test("la BAJA sigue sin clasificar", async () => {
    const r = await onMessageReceivedHandler(
      {
        parsed: parsed({
          contenido: "BAJA",
          meta_user_id: "593990001771",
          canal_thread_id: "593990001771",
        }),
      },
      ctx.deps,
    );
    expect(r.agentSource).toBe("baja");
    expect(ctx.intentLLM.calls).toHaveLength(0);
  });
});

/**
 * La falla grave que esto arregla: un lead con el tope de frecuencia lleno
 * escribía algo que coincidía con un interceptor, el agente callaba y el envío
 * del flujo saltaba por el tope. El cliente no recibía nada.
 */
describe("on-message-received — nunca se silencia al agente si el flujo no puede responder", () => {
  let ctx: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeDeps([version(responderHorario(regla("lead.canal", "wa")))]);
  });

  async function llenarElTope() {
    for (let i = 0; i < TOPE; i++) {
      ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
      ctx.agentLLM.enqueueText(`respuesta ${i}`);
      await onMessageReceivedHandler(
        { parsed: parsed({ meta_message_id: `wamid.PREV-${i}`, contenido: "hola" }) },
        ctx.deps,
      );
    }
  }

  test("con el tope lleno contesta el agente y el turno no queda como interceptado", async () => {
    await llenarElTope();
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Abrimos de 9 a 18.");
    const llamadasAntes = ctx.agentLLM.calls.length;

    const r = await onMessageReceivedHandler(
      { parsed: parsed({ meta_message_id: "wamid.IN-TOPE" }) },
      ctx.deps,
    );

    expect(ctx.agentLLM.calls).toHaveLength(llamadasAntes + 1);
    expect(r.agentSource).toBe("llm");
    expect(r.sent).toBe(true);
    const disparo = disparosMensaje(ctx.emitted).at(-1);
    expect(disparo?.data.interceptadoPor).toBeUndefined();
    const entrante = (await ctx.messages.findByMetaMessageId("wamid.IN-TOPE"))!;
    expect(await ctx.turnos.listByMensajeIds([entrante.id])).toEqual([]);
  });

  test("con el tope libre contesta el flujo y el agente calla", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.agentLLM.calls).toHaveLength(0);
    expect(r.agentSource).toBe("flujo");
    expect(disparosMensaje(ctx.emitted)[0]?.data.interceptadoPor).toBe("wf-horario");
  });
});

/**
 * Decisión del dueño: fuera de horario no se intercepta. El flujo no puede
 * prometer una respuesta que después se difiere; contesta lo de siempre fuera
 * de horario (la plantilla de `agente_config`). El flujo se dispara igual como
 * "Mensaje recibido", sin contestar el turno.
 */
describe("on-message-received — fuera de horario no se intercepta", () => {
  const SIN_HORARIO = { desde: "00:00", hasta: "00:00" };
  const cerrado = {
    ...CONFIG_DE_FABRICA,
    horario: {
      lun: [SIN_HORARIO],
      mar: [SIN_HORARIO],
      mie: [SIN_HORARIO],
      jue: [SIN_HORARIO],
      vie: [SIN_HORARIO],
      sab: [SIN_HORARIO],
      dom: [SIN_HORARIO],
    },
    plantilla_fuera_horario: "Estamos cerrados, te respondemos al abrir.",
  };

  /** Un interceptor que no manda nada: escala a una persona (avisa al equipo). */
  function escalarHorario(): Grafo {
    return {
      nodos: [
        nodo("t", "trigger_mensaje", {
          interceptaLlm: true,
          filtro: "contiene",
          palabra: "horario",
        }),
        nodo("a", "int_notif_vendedor", { destinatario: "vendedor_asignado", mensaje: "ojo" }),
        nodo("d", "logica_detener"),
      ],
      aristas: [
        { desde: "t", hasta: "a", puerto: "salida" },
        { desde: "a", hasta: "d", puerto: "salida" },
      ],
    };
  }

  test("contesta la plantilla de fuera de horario y el turno no queda interceptado", async () => {
    const ctx = makeDeps([version(escalarHorario())]);
    ctx.deps.configProvider = new StaticAgentConfigProvider(cerrado);

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(r.agentSource).toBe("handoff");
    expect(r.sent).toBe(true);
    const mensajes = await ctx.messages.listByConversacion(r.conversacionId);
    expect(mensajes.filter((m) => m.direction === "out").map((m) => m.contenido)).toEqual([
      cerrado.plantilla_fuera_horario,
    ]);
    const entrante = mensajes.find((m) => m.direction === "in")!;
    expect(await ctx.turnos.listByMensajeIds([entrante.id])).toEqual([]);
    // El flujo se entera como "Mensaje recibido", sin contestar el turno.
    const [disparo] = disparosMensaje(ctx.emitted);
    expect(disparo).toBeDefined();
    expect(disparo?.data.interceptadoPor).toBeUndefined();
  });
});

describe("on-message-received — el toque de un botón que un flujo espera", () => {
  let ctx: ReturnType<typeof makeDeps>;

  beforeEach(async () => {
    ctx = makeDeps([]);
  });

  async function corridaEsperando(leadId: string) {
    const { run } = await ctx.runs.arrancar({
      versionId: "v-botones",
      leadId,
      sessionId: null,
      contexto: {},
    });
    await ctx.runs.esperar(run!.id, "botones", marcarEsperaDeOpcion("botones", "wamid.OUT-9"), 3);
    return run!.id;
  }

  async function leadConocido() {
    // Un primer mensaje crea el lead; lo contesta el agente.
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("hola");
    const r = await onMessageReceivedHandler(
      { parsed: parsed({ meta_message_id: "wamid.IN-0", contenido: "hola" }) },
      ctx.deps,
    );
    return r.leadId;
  }

  test("un toque de botón esperado no hace responder al agente", async () => {
    const leadId = await leadConocido();
    const runId = await corridaEsperando(leadId);
    const llamadasAntes = ctx.agentLLM.calls.length;

    const r = await onMessageReceivedHandler(
      {
        parsed: parsed({
          meta_message_id: "wamid.IN-2",
          contenido: "Sí, cotizar",
          respuesta_interactiva: { id: "si", titulo: "Sí, cotizar", responde_a: "wamid.OUT-9" },
        }),
      },
      ctx.deps,
    );

    expect(ctx.agentLLM.calls).toHaveLength(llamadasAntes);
    expect(r.agentSource).toBe("flujo");
    expect(ctx.emitted.some((e) => e.name === "workflow/respuesta.interactiva")).toBe(true);
    const entrante = (await ctx.messages.findByMetaMessageId("wamid.IN-2"))!;
    expect(await ctx.turnos.listByMensajeIds([entrante.id])).toMatchObject([
      { workflow_id: "wf-botones", workflow_run_id: runId, motivo: "respuesta_esperada" },
    ]);
  });

  test("texto libre con una corrida esperando un botón: contesta el agente", async () => {
    const leadId = await leadConocido();
    await corridaEsperando(leadId);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Te paso el precio");
    const llamadasAntes = ctx.agentLLM.calls.length;

    const r = await onMessageReceivedHandler(
      { parsed: parsed({ meta_message_id: "wamid.IN-3", contenido: "y cuánto sale?" }) },
      ctx.deps,
    );

    expect(ctx.agentLLM.calls).toHaveLength(llamadasAntes + 1);
    expect(r.agentSource).toBe("llm");
  });
});
