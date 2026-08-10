import { beforeEach, describe, expect, test, vi } from "vitest";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import {
  StaticAgentConfigProvider,
  type AgentConfigProvider,
} from "@/server/services/agente/config-provider";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import {
  onMessageReceivedHandler,
  type OnMessageReceivedDeps,
  type EmittedEvent,
} from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { DIAS_SEMANA, type Horario } from "@/types/agente";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

/** Horario sin ningun rango en ningun dia: `estaAbierto` da false siempre. */
function horarioCerradoSiempre(): Horario {
  const horario = {} as Horario;
  for (const dia of DIAS_SEMANA) horario[dia] = [];
  return horario;
}

function parsed(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    canal_thread_id: "549110",
    meta_user_id: "549110",
    meta_message_id: "wamid.IN-1",
    tipo: "text",
    contenido: "hola",
    media_url: null,
    raw: { type: "text" },
    ...overrides,
  };
}

function makeDeps(
  configProvider: AgentConfigProvider = new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
): {
  deps: OnMessageReceivedDeps;
  emitted: EmittedEvent[];
  metaClient: FakeMetaApiClient;
  intentLLM: FakeIntentClassifierLLM;
  agentLLM: FakeAgentLLM;
  leads: InMemoryLeadsRepository;
  conversations: InMemoryConversationsRepository;
  sessions: InMemoryLeadSessionRepository;
  messages: InMemoryMessagesRepository;
  intents: InMemoryIntentsRepository;
  rules: InMemoryRulesRepository;
  ruleExecutions: InMemoryRuleExecutionsRepository;
  productos: InMemoryProductsRepository;
} {
  const leads = new InMemoryLeadsRepository();
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const productos = new InMemoryProductsRepository();
  const ruleExecutions = new InMemoryRuleExecutionsRepository();

  const intentLLM = new FakeIntentClassifierLLM();
  const agentLLM = new FakeAgentLLM();
  const metaClient = new FakeMetaApiClient();

  const metaApi = new DefaultMetaApiService(conversations, messages, metaClient);
  const intentClassifier = new DefaultIntentClassifierService(intents, intentLLM);
  const ruleEngine = new DefaultRuleEngineService(intents, rules);
  const catalog = new DefaultCatalogMatcherService(productos);
  const aiAgent = new DefaultAiAgentService(sessions, ruleEngine, catalog, agentLLM);

  const emitted: EmittedEvent[] = [];
  const emit = async (e: EmittedEvent) => {
    emitted.push(e);
  };

  const deps: OnMessageReceivedDeps = {
    leads,
    conversations,
    sessions,
    messages,
    metaApi,
    intentClassifier,
    aiAgent,
    ruleExecutions,
    configProvider,
    emit,
  };

  return {
    deps,
    emitted,
    metaClient,
    intentLLM,
    agentLLM,
    leads,
    conversations,
    sessions,
    messages,
    intents,
    rules,
    ruleExecutions,
    productos,
  };
}

describe("onMessageReceivedHandler", () => {
  let ctx: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeDeps();
  });

  test("WA mensaje nuevo crea lead + conv + session + persiste inbound", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("hola, ¿en qué te ayudo?");

    const result = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(result.leadCreated).toBe(true);
    expect(result.sessionCreated).toBe(true);

    const lead = await ctx.leads.findByTelefono("549110");
    expect(lead).not.toBeNull();
    expect(lead!.canal_origen).toBe("wa");
    expect(lead!.meta_user_ids.wa).toBe("549110");

    const conv = await ctx.conversations.findByCanalThread("wa", "549110");
    expect(conv).not.toBeNull();
    expect(conv!.lead_id).toBe(lead!.id);

    const session = await ctx.sessions.findActiveByLeadId(lead!.id);
    expect(session).not.toBeNull();

    const msgs = await ctx.messages.listByConversacion(conv!.id);
    expect(msgs).toHaveLength(2);
    const inbound = msgs.find((m) => m.direction === "in")!;
    expect(inbound.contenido).toBe("hola");
    expect(inbound.meta_message_id).toBe("wamid.IN-1");
  });

  test("WA lead existente no se duplica", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta");
    await ctx.leads.create({
      nombre: "Juan",
      telefono: "549110",
      email: null,
      direccion: null,
      vehiculo_marca: "",
      vehiculo_modelo: "",
      vehiculo_anio: 0,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: "549110" },
    });

    const result = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(result.leadCreated).toBe(false);
    const all = await ctx.leads.list();
    expect(all).toHaveLength(1);
  });

  test("IG mensaje crea lead con telefono placeholder ig:USERID", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("hola IG");

    await onMessageReceivedHandler(
      { parsed: parsed({ canal: "ig", canal_thread_id: "IGSID", meta_user_id: "IGSID" }) },
      ctx.deps,
    );

    const lead = await ctx.leads.findByMetaUserId("ig", "IGSID");
    expect(lead).not.toBeNull();
    expect(lead!.telefono).toBe("ig:IGSID");
    expect(lead!.canal_origen).toBe("ig");
    expect(lead!.meta_user_ids.ig).toBe("IGSID");
  });

  test("agent source=llm envia respuesta via meta client", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("tenemos varios modelos");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(1);
    expect(ctx.metaClient.calls[0]).toEqual({
      canal: "wa",
      to: "549110",
      text: "tenemos varios modelos",
    });
  });

  test("agent source=handoff NO envia respuesta", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: "saludo", confidence: 0.9 });
    const intent = await ctx.intents.create({
      nombre: "saludo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    await ctx.rules.create({
      intent_id: intent.id,
      condiciones_extra: null,
      respuesta_tipo: "handoff",
      respuesta_contenido: "Pasando a humano",
      prioridad: 0,
      activa: true,
    });

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
  });

  test("sesion existente ia_pausada NO envia respuesta", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    const lead = await ctx.leads.create({
      nombre: "",
      telefono: "549110",
      email: null,
      direccion: null,
      vehiculo_marca: "",
      vehiculo_modelo: "",
      vehiculo_anio: 0,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: "549110" },
    });
    await ctx.sessions.create({
      lead_id: lead.id,
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
      ia_pausada: true,
    });

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
  });

  test("dedup webhook: mismo meta_message_id procesado 2x persiste 1 inbound", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("uno");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("dos");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);
    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const lead = await ctx.leads.findByTelefono("549110");
    const conv = await ctx.conversations.findByCanalThread("wa", "549110");
    const all = await ctx.messages.listByConversacion(conv!.id);
    const inbound = all.filter((m) => m.direction === "in");
    expect(inbound).toHaveLength(1);
    expect(lead).not.toBeNull();
  });

  test("emite turn.completed con sessionId + conversationTurn", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const turnEvent = ctx.emitted.find((e) => e.name === "lead-session/turn.completed");
    expect(turnEvent).toBeDefined();
    expect(turnEvent!.data.conversationTurn.length).toBeGreaterThan(0);
  });

  test("emite auto-handoff.evaluate con recentClassifications", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("x");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const handoffEvent = ctx.emitted.find((e) => e.name === "lead-session/auto-handoff.evaluate");
    expect(handoffEvent).toBeDefined();
    expect(Array.isArray(handoffEvent!.data.recentClassifications)).toBe(true);
  });

  test("classify recibe contenido del mensaje", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("x");
    await ctx.intents.create({
      nombre: "saludo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });

    await onMessageReceivedHandler({ parsed: parsed({ contenido: "buenas tardes" }) }, ctx.deps);

    expect(ctx.intentLLM.calls).toHaveLength(1);
    expect(ctx.intentLLM.calls[0].text).toBe("buenas tardes");
  });

  test("mensaje image sin contenido pasa string vacio al classifier", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("img recibida");
    await ctx.intents.create({
      nombre: "x",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });

    await onMessageReceivedHandler(
      { parsed: parsed({ tipo: "image", contenido: null }) },
      ctx.deps,
    );

    expect(ctx.intentLLM.calls[0].text).toBe("");
  });

  test("una respuesta por regla queda auditada contra el mensaje entrante", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: "saludo", confidence: 0.9 });
    const intent = await ctx.intents.create({
      nombre: "saludo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    const regla = await ctx.rules.create({
      intent_id: intent.id,
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "¡Hola! ¿Qué repuesto buscás?",
      prioridad: 0,
      activa: true,
    });

    const out = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(out.agentSource).toBe("rule");
    const auditoria = await ctx.ruleExecutions.listByRegla(regla.id);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]?.matched_intent_id).toBe(intent.id);

    // Contra el ENTRANTE: la pregunta que responde esta tabla es qué disparó
    // la regla, y lo que la disparó fue lo que escribió el cliente.
    const delLead = (await ctx.messages.listBySessionId(out.sessionId)).find(
      (m) => m.direction === "in",
    );
    expect(auditoria[0]?.mensaje_id).toBe(delLead?.id);
  });
});

describe("config del agente en el pipeline", () => {
  test("la ventana de contexto sale de la config, no de una constante", async () => {
    const local = makeDeps(
      new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, ventana_contexto_mensajes: 4 }),
    );
    const spy = vi.spyOn(local.messages, "listByConversacion");
    local.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    local.agentLLM.enqueueText("ok");

    await onMessageReceivedHandler({ parsed: parsed() }, local.deps);

    expect(spy).toHaveBeenCalledWith(expect.any(String), { limit: 4 });
  });

  test("fuera de horario no invoca al LLM y responde la plantilla", async () => {
    const local = makeDeps(
      new StaticAgentConfigProvider({
        ...CONFIG_DE_FABRICA,
        horario: horarioCerradoSiempre(),
        plantilla_fuera_horario: "Estamos cerrados, te respondemos manana.",
      }),
    );

    await onMessageReceivedHandler({ parsed: parsed() }, local.deps);

    expect(local.agentLLM.calls).toHaveLength(0);
    expect(local.metaClient.calls.at(-1)?.text).toBe("Estamos cerrados, te respondemos manana.");
  });

  test("fuera de horario sin plantilla no responde nada", async () => {
    const local = makeDeps(
      new StaticAgentConfigProvider({
        ...CONFIG_DE_FABRICA,
        horario: horarioCerradoSiempre(),
        plantilla_fuera_horario: "",
      }),
    );

    await onMessageReceivedHandler({ parsed: parsed() }, local.deps);

    expect(local.metaClient.calls).toHaveLength(0);
  });

  test("una respuesta que excede el descuento no se envia", async () => {
    const local = makeDeps(
      new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, descuento_max_pct: 5 }),
    );
    const spy = vi.spyOn(local.sessions, "update");
    local.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    local.agentLLM.enqueueText("Te hago un 20% de descuento.");

    await onMessageReceivedHandler({ parsed: parsed() }, local.deps);

    expect(local.metaClient.calls).toHaveLength(0);
    expect(spy).toHaveBeenCalledWith(expect.any(String), {
      current_stage: "requiere_humano",
      ia_pausada: true,
    });
  });

  test("una respuesta dentro del descuento se envia normal", async () => {
    const local = makeDeps(
      new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, descuento_max_pct: 25 }),
    );
    local.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    local.agentLLM.enqueueText("Te hago un 20% de descuento.");

    await onMessageReceivedHandler({ parsed: parsed() }, local.deps);

    expect(local.metaClient.calls).toHaveLength(1);
  });
});
