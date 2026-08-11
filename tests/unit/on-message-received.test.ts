import { beforeEach, describe, expect, test, vi } from "vitest";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemorySessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";
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
    nombre_perfil: null,
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
  turnClassifications: InMemoryTurnClassificationsRepository;
  productos: InMemoryProductsRepository;
  recordatorios: InMemorySessionRecordatoriosRepository;
} {
  const leads = new InMemoryLeadsRepository();
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const productos = new InMemoryProductsRepository();
  const ruleExecutions = new InMemoryRuleExecutionsRepository();
  const turnClassifications = new InMemoryTurnClassificationsRepository();
  const recordatorios = new InMemorySessionRecordatoriosRepository();

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
    turnClassifications,
    intents,
    recordatorios,
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
    turnClassifications,
    productos,
    recordatorios,
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

  test("el lead nuevo guarda el nombre de perfil de Meta sin tocar nombre", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta");

    await onMessageReceivedHandler({ parsed: parsed({ nombre_perfil: "Marcela" }) }, ctx.deps);

    const lead = await ctx.leads.findByTelefono("549110");
    expect(lead!.nombre_perfil).toBe("Marcela");
    // El nombre de la casa lo escribe el vendedor: el alias de redes no lo pisa.
    expect(lead!.nombre).toBe("");
  });

  test("un cambio de nombre de perfil se sincroniza en el lead existente", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta");
    const previo = await ctx.leads.create({
      nombre: "Juan el del Corolla",
      nombre_perfil: "Juan",
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

    await onMessageReceivedHandler({ parsed: parsed({ nombre_perfil: "Juan P." }) }, ctx.deps);

    const lead = await ctx.leads.findById(previo.id);
    expect(lead!.nombre_perfil).toBe("Juan P.");
    expect(lead!.nombre).toBe("Juan el del Corolla");
  });

  test("un canal sin nombre de perfil no borra el que ya estaba", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta");
    const previo = await ctx.leads.create({
      nombre: "",
      nombre_perfil: "Juan",
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

    await onMessageReceivedHandler({ parsed: parsed({ nombre_perfil: null }) }, ctx.deps);

    const lead = await ctx.leads.findById(previo.id);
    expect(lead!.nombre_perfil).toBe("Juan");
    // Sin cambio no hay UPDATE: escribir en cada entrante movería `updated_at`
    // de todos los leads y desordenaría la lista, que ordena por esa columna.
    expect(lead!.updated_at).toEqual(previo.updated_at);
  });

  test("el mismo nombre de perfil no genera UPDATE", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta");
    const previo = await ctx.leads.create({
      nombre: "",
      nombre_perfil: "Marcela",
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

    await onMessageReceivedHandler({ parsed: parsed({ nombre_perfil: "Marcela" }) }, ctx.deps);

    const lead = await ctx.leads.findById(previo.id);
    expect(lead!.updated_at).toEqual(previo.updated_at);
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

  test("turn.completed viaja con el entrante que lo disparó", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta");

    const out = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const turnEvent = ctx.emitted.find((e) => e.name === "lead-session/turn.completed");
    const delLead = (await ctx.messages.listBySessionId(out.sessionId)).find(
      (m) => m.direction === "in",
    );
    // Sin este id el extractor no puede anotar de qué mensaje salió cada campo
    // y la línea "origen: mensaje del cliente · 09:12" del Twin queda muda.
    expect(turnEvent!.data.mensajeOrigenId).toBe(delLead?.id);
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

    // La otra mitad no se escribe: el turno lo resolvió una regla, no el LLM.
    expect(await ctx.turnClassifications.findByMensajeId(delLead!.id)).toBeNull();
  });

  test("un turno que resolvió el LLM deja su clasificación persistida", async () => {
    const intent = await ctx.intents.create({
      nombre: "consulta_precio",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    // Clasifica, pero ninguna regla cubre el intent ⇒ contesta el LLM.
    ctx.intentLLM.enqueue({ intent_nombre: "consulta_precio", confidence: 0.87 });
    ctx.agentLLM.enqueueText("sale 120.000");

    const out = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(out.agentSource).toBe("llm");
    const delLead = (await ctx.messages.listBySessionId(out.sessionId)).find(
      (m) => m.direction === "in",
    );
    const fila = await ctx.turnClassifications.findByMensajeId(delLead!.id);
    expect(fila).not.toBeNull();
    expect(fila?.intent_id).toBe(intent.id);
    expect(fila?.intent_nombre).toBe("consulta_precio");
    expect(fila?.confidence).toBe(0.87);
  });

  test("un turno que el clasificador no reconoció se audita con intent nulo", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta");

    const out = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const delLead = (await ctx.messages.listBySessionId(out.sessionId)).find(
      (m) => m.direction === "in",
    );
    const fila = await ctx.turnClassifications.findByMensajeId(delLead!.id);
    // La fila igual se escribe: un turno sin intent reconocido es justamente
    // el que hay que poder contar para descubrir intents que faltan.
    expect(fila).not.toBeNull();
    expect(fila?.intent_id).toBeNull();
    expect(fila?.intent_nombre).toBeNull();
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

describe("onMessageReceivedHandler — el cliente que vuelve apaga su seguimiento", () => {
  let ctx: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeDeps();
  });

  /** Deja al lead con sesión abierta y una cita de seguimiento encima. */
  async function conRecordatorio() {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("hola");
    const primero = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const recordatorio = await ctx.recordatorios.create({
      lead_session_id: primero.sessionId,
      recordar_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
      nota: "dijo que lo pensaba",
      creado_por: null,
    });
    return { sessionId: primero.sessionId, recordatorio };
  }

  test("un mensaje del cliente cancela el recordatorio de la sesión", async () => {
    // El sentido del recordatorio es "se quedó callado": si escribió, ya no
    // hace falta perseguirlo.
    const { recordatorio } = await conRecordatorio();
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("dale");

    await onMessageReceivedHandler(
      { parsed: parsed({ meta_message_id: "wamid.IN-2", contenido: "lo pensé, lo llevo" }) },
      ctx.deps,
    );

    const despues = await ctx.recordatorios.findById(recordatorio.id);
    expect(despues?.estado).toBe("cancelado");
    expect(despues?.motivo_cancelacion).toBe("respondio");
  });

  test("cancela aunque el mensaje llegue fuera de horario y nadie conteste", async () => {
    // La cancelación va pegada al entrante y antes de todas las salidas
    // tempranas: un mensaje a las 3 AM cuenta igual como "el cliente volvió".
    const local = makeDeps(
      new StaticAgentConfigProvider({
        ...CONFIG_DE_FABRICA,
        horario: horarioCerradoSiempre(),
        plantilla_fuera_horario: "",
      }),
    );
    local.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    const primero = await onMessageReceivedHandler({ parsed: parsed() }, local.deps);
    const recordatorio = await local.recordatorios.create({
      lead_session_id: primero.sessionId,
      recordar_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
      nota: "",
      creado_por: null,
    });

    await onMessageReceivedHandler(
      { parsed: parsed({ meta_message_id: "wamid.IN-3" }) },
      local.deps,
    );

    expect((await local.recordatorios.findById(recordatorio.id))?.estado).toBe("cancelado");
  });

  test("sin recordatorios el pipeline sigue igual", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("hola");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(r.sent).toBe(true);
  });
});
