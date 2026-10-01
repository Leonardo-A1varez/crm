import { afterEach, describe, expect, test, vi } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { BudgetExceededError, IllegalStateError } from "@/lib/errors";
import {
  onMessageReceivedHandler,
  type EmittedEvent,
  type OnMessageReceivedDeps,
} from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DIAS_SEMANA, type AgenteConfigValores, type Horario } from "@/types/agente";
import type { ModoOverride } from "@/types/copiloto";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

function horario(abierto: boolean): Horario {
  const h = {} as Horario;
  for (const dia of DIAS_SEMANA) h[dia] = abierto ? [{ desde: "00:00", hasta: "23:59" }] : [];
  return h;
}

/** Equipo de turno las 24 h: el modo no depende de qué hora sea cuando corre el test. */
const EQUIPO = { horario_equipo: horario(true) };

// Un teléfono válido para la lista de bajas (E.164, 7-15 dígitos).
const TEL = "5491155551234";

function parsed(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    canal_thread_id: TEL,
    meta_user_id: TEL,
    meta_message_id: "wamid.IN-1",
    tipo: "text",
    contenido: "Busco filtro de aceite",
    media_url: null,
    nombre_perfil: null,
    raw: { type: "text" },
    ...overrides,
  };
}

function makeCtx(
  config: Partial<AgenteConfigValores> = {},
  opciones: {
    sinBorradores?: boolean;
    delegaciones?: OnMessageReceivedDeps["delegaciones"];
  } = {},
) {
  const leads = new InMemoryLeadsRepository();
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const intentLLM = new FakeIntentClassifierLLM();
  const agentLLM = new FakeAgentLLM();
  const metaClient = new FakeMetaApiClient();
  // El RPC de la base resuelve "¿es el último entrante?" con la tabla `mensajes`.
  // Con empates de milésima (created_at) gana el último insertado.
  const borradores = new InMemoryBorradoresIaRepository(async (conversacionId) => {
    const entrantes = (await messages.listByConversacion(conversacionId, { limit: 200 })).filter(
      (m) => m.direction === "in",
    );
    const tope = entrantes[0]?.created_at.getTime();
    return entrantes.filter((m) => m.created_at.getTime() === tope).at(-1)?.id ?? null;
  });
  const ruleEngine = new DefaultRuleEngineService(
    intents,
    rules,
    new InMemoryReglasEtiquetaRepository(),
  );
  const ruleExecutions = new InMemoryRuleExecutionsRepository();
  const emitted: EmittedEvent[] = [];
  const deps: OnMessageReceivedDeps = {
    leads,
    conversations,
    sessions,
    messages,
    metaApi: new DefaultMetaApiService(conversations, messages, metaClient),
    intentClassifier: new DefaultIntentClassifierService(intents, intentLLM),
    aiAgent: new DefaultAiAgentService(
      sessions,
      ruleEngine,
      new DefaultCatalogMatcherService(new InMemoryProductsRepository()),
      agentLLM,
    ),
    ruleExecutions,
    turnClassifications: new InMemoryTurnClassificationsRepository(),
    ruleEngine,
    tags: new InMemoryTagsRepository(),
    intents,
    identificadores: new InMemoryLeadIdentificadoresRepository(),
    supresiones: new InMemoryDifusionSupresionesRepository(),
    respuestaDifusion: { registrar: async () => null },
    plantillasSinSesion: { registrar: async () => 0 },
    ...(opciones.sinBorradores ? {} : { borradores }),
    ...(opciones.delegaciones ? { delegaciones: opciones.delegaciones } : {}),
    configProvider: new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, ...config }),
    emit: async (e) => {
      emitted.push(e);
    },
  };
  return {
    deps,
    emitted,
    leads,
    conversations,
    sessions,
    messages,
    intents,
    rules,
    ruleExecutions,
    intentLLM,
    agentLLM,
    metaClient,
    borradores,
  };
}
type Ctx = ReturnType<typeof makeCtx>;

/** Un lead de WhatsApp con su conversación ya creada y el override que se pide. */
async function conOverride(ctx: Ctx, modo: ModoOverride | null) {
  const lead = await ctx.leads.create({
    nombre: "Ana",
    telefono: TEL,
    email: null,
    direccion: null,
    vehiculo_marca: "",
    vehiculo_modelo: "",
    vehiculo_anio: 0,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: { wa: TEL },
  });
  const conv = await ctx.conversations.create({
    lead_id: lead.id,
    canal: "wa",
    canal_thread_id: TEL,
  });
  await ctx.conversations.update(conv.id, { modo_respuesta_override: modo });
  return { lead, conv };
}

async function conversacionDe(ctx: Ctx, canal: "wa" | "ig" = "wa", hilo = TEL) {
  const conv = await ctx.conversations.findByCanalThread(canal, hilo);
  if (!conv) throw new Error("la conversación no existe");
  return conv;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("on-message-received — modo Copiloto", () => {
  test("equipo abierto y agente abierto: no se envía nada y queda un borrador listo", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Sí, tenemos filtros de aceite.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(r.sent).toBe(false);
    expect(r.agentSource).toBe("llm");
    const b = await ctx.borradores.findActualByConversacion(r.conversacionId);
    expect(b).toMatchObject({
      estado: "listo",
      contenido: "Sí, tenemos filtros de aceite.",
      origen: "ia",
      regla_id: null,
    });
    const salientes = (await ctx.messages.listByConversacion(r.conversacionId)).filter(
      (m) => m.direction === "out",
    );
    expect(salientes).toHaveLength(0);
  });

  test("el borrador cuelga del entrante que lo disparó", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const entrante = (await ctx.messages.listByConversacion(r.conversacionId)).find(
      (m) => m.direction === "in",
    );
    const b = await ctx.borradores.findActualByConversacion(r.conversacionId);
    expect(b?.mensaje_origen_id).toBe(entrante?.id);
    expect(b?.lead_session_id).toBe(r.sessionId);
  });

  test("una respuesta de regla IF/THEN también queda como borrador, con origen regla", async () => {
    const ctx = makeCtx(EQUIPO);
    const intent = await ctx.intents.create({
      nombre: "horario",
      descripcion: "pregunta por el horario",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    const regla = await ctx.rules.create({
      intent_id: intent.id,
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "Abrimos de 9 a 18",
      prioridad: 0,
      activa: true,
    });
    ctx.intentLLM.enqueue({ intent_nombre: "horario", confidence: 0.9 });

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.agentLLM.calls).toHaveLength(0);
    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(r.agentSource).toBe("rule");
    const b = await ctx.borradores.findActualByConversacion(r.conversacionId);
    expect(b).toMatchObject({
      estado: "listo",
      contenido: "Abrimos de 9 a 18",
      origen: "regla",
      regla_id: regla.id,
    });
    // La regla sí disparó: su auditoría queda aunque nada salga por la API.
    const entrante = (await ctx.messages.listByConversacion(r.conversacionId)).find(
      (m) => m.direction === "in",
    );
    expect(await ctx.ruleExecutions.findByMensajeId(entrante!.id)).toMatchObject({
      regla_id: regla.id,
    });
  });

  test("agente cerrado pero equipo abierto: no se manda la plantilla y sí se redacta", async () => {
    const ctx = makeCtx({
      ...EQUIPO,
      horario: horario(false),
      plantilla_fuera_horario: "Estamos cerrados.",
    });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Borrador con el agente cerrado.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(ctx.agentLLM.calls).toHaveLength(1);
    expect((await ctx.borradores.findActualByConversacion(r.conversacionId))?.estado).toBe("listo");
  });

  test("override Copiloto fijo con equipo y agente cerrados (O2): borrador, sin plantilla", async () => {
    const ctx = makeCtx({ horario: horario(false), plantilla_fuera_horario: "Estamos cerrados." });
    await conOverride(ctx, "copiloto");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Borrador por override.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect((await ctx.borradores.findActualByConversacion(r.conversacionId))?.contenido).toBe(
      "Borrador por override.",
    );
  });

  test("sin repositorio de borradores el turno falla en voz alta y no manda nada por la API", async () => {
    const ctx = makeCtx(EQUIPO, { sinBorradores: true });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("No debería salir.");

    await expect(onMessageReceivedHandler({ parsed: parsed() }, ctx.deps)).rejects.toBeInstanceOf(
      IllegalStateError,
    );

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(ctx.agentLLM.calls).toHaveLength(0);
  });

  test("al tramo delegado se le avisa que la IA no respondió al cliente", async () => {
    // "Delegar al agente" ramifica según si el agente contestó. En Copiloto la
    // IA redactó pero no le habló al cliente: respondio=false.
    const ctx = makeCtx(EQUIPO, {
      delegaciones: {
        delegacionesActivas: async () => [{ runId: "run-1", instrucciones: null }],
      },
    });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Borrador para el tramo.");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const completado = ctx.emitted.find((e) => e.name === "lead-session/turn.completed");
    expect(completado?.data).toMatchObject({
      delegacion: { runIds: ["run-1"], respondio: false },
    });
  });
});

describe("on-message-received — los otros modos siguen igual que hoy", () => {
  test("Según horario con equipo cerrado y agente abierto: Automático, sale por la API y no hay borrador", async () => {
    const ctx = makeCtx(); // horario_equipo de fábrica: sin ningún rango
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta por la API.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(1);
    expect(ctx.metaClient.calls[0]?.text).toBe("Respuesta por la API.");
    expect(r.sent).toBe(true);
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
  });

  test("override Automático con el equipo abierto: sale por la API", async () => {
    const ctx = makeCtx(EQUIPO);
    await conOverride(ctx, "automatico");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Automático fijo.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(1);
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
  });

  test("equipo y agente cerrados: plantilla de fuera de horario, sin LLM y sin borrador", async () => {
    const ctx = makeCtx({ horario: horario(false), plantilla_fuera_horario: "Estamos cerrados." });

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.agentLLM.calls).toHaveLength(0);
    expect(ctx.metaClient.calls.at(-1)?.text).toBe("Estamos cerrados.");
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
  });

  test("Automático fijo con el agente cerrado: Fuera de horario (plantilla o nada)", async () => {
    const ctx = makeCtx({ ...EQUIPO, horario: horario(false), plantilla_fuera_horario: "" });
    await conOverride(ctx, "automatico");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(ctx.agentLLM.calls).toHaveLength(0);
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
  });

  test("Instagram: el copiloto es de WhatsApp, así que el equipo abierto no cambia nada", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta por Instagram.");

    const r = await onMessageReceivedHandler(
      { parsed: parsed({ canal: "ig", canal_thread_id: "IGSID", meta_user_id: "IGSID" }) },
      ctx.deps,
    );

    expect(ctx.metaClient.calls).toHaveLength(1);
    expect(r.sent).toBe(true);
    const conv = await conversacionDe(ctx, "ig", "IGSID");
    expect(await ctx.borradores.findActualByConversacion(conv.id)).toBeNull();
  });
});

describe("on-message-received — cuando la IA no respondería, tampoco hay borrador", () => {
  test("sesión con la IA pausada: el borrador que arrancó se descarta", async () => {
    const ctx = makeCtx(EQUIPO);
    const { lead } = await conOverride(ctx, null);
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
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(r.agentSource).toBe("handoff");
    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
  });

  test("descuento excedido: la IA se pausa y no queda borrador", async () => {
    const ctx = makeCtx({ ...EQUIPO, descuento_max_pct: 5 });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Te hago un 20% de descuento.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
    const sesion = await ctx.sessions.findById(r.sessionId);
    expect(sesion?.ia_pausada).toBe(true);
  });

  test("BAJA: la confirmación sale por la API como siempre y el borrador anterior se invalida", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Borrador previo.");
    const primero = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);
    expect((await ctx.borradores.findActualByConversacion(primero.conversacionId))?.estado).toBe(
      "listo",
    );

    await onMessageReceivedHandler(
      { parsed: parsed({ meta_message_id: "wamid.IN-2", contenido: "BAJA" }) },
      ctx.deps,
    );

    expect(ctx.metaClient.calls).toHaveLength(1); // solo la confirmación de baja
    expect(await ctx.borradores.findActualByConversacion(primero.conversacionId)).toBeNull();
  });

  test("un flujo intercepta el turno: no se crea borrador y el anterior queda invalidado", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Borrador previo.");
    const primero = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);
    const previo = await ctx.borradores.findActualByConversacion(primero.conversacionId);
    expect(previo?.estado).toBe("listo");

    ctx.deps.interceptor = {
      decidir: async () => ({
        tipo: "intercepta",
        motivo: "condicion",
        workflowId: "wf-horario",
        versionId: "v-horario",
      }),
      registrar: async () => {},
    };
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    const r = await onMessageReceivedHandler(
      { parsed: parsed({ meta_message_id: "wamid.IN-2", contenido: "¿cuál es el horario?" }) },
      ctx.deps,
    );

    expect(r.agentSource).toBe("flujo");
    expect(ctx.agentLLM.calls).toHaveLength(1); // solo el del primer turno
    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(await ctx.borradores.findActualByConversacion(primero.conversacionId)).toBeNull();
    expect((await ctx.borradores.findById(previo!.id))?.estado).toBe("descartado");
  });
});

describe("on-message-received — el borrador del mensaje nuevo reemplaza al anterior", () => {
  test("el segundo mensaje descarta el borrador del primero y deja uno solo vigente", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta al primero.");
    const r1 = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);
    const primero = await ctx.borradores.findActualByConversacion(r1.conversacionId);

    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta al segundo.");
    await onMessageReceivedHandler(
      { parsed: parsed({ meta_message_id: "wamid.IN-2", contenido: "¿y en stock?" }) },
      ctx.deps,
    );

    const actual = await ctx.borradores.findActualByConversacion(r1.conversacionId);
    expect(actual?.id).not.toBe(primero?.id);
    expect(actual?.contenido).toBe("Respuesta al segundo.");
    expect((await ctx.borradores.findById(primero!.id))?.estado).toBe("descartado");
  });

  test("cambiar el override entre dos mensajes: el segundo sale por la API y el borrador viejo se invalida", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Borrador 1.");
    const r1 = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    await ctx.conversations.update(r1.conversacionId, { modo_respuesta_override: "automatico" });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta 2 por la API.");
    await onMessageReceivedHandler({ parsed: parsed({ meta_message_id: "wamid.IN-2" }) }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(1);
    expect(await ctx.borradores.findActualByConversacion(r1.conversacionId)).toBeNull();
  });

  test("el horario del equipo se evalúa al llegar cada mensaje, no una sola vez", async () => {
    // Equipo de 09:00 a 18:00 UTC; el agente atiende las 24 h.
    const horarioEquipo = {} as Horario;
    for (const dia of DIAS_SEMANA) horarioEquipo[dia] = [{ desde: "09:00", hasta: "18:00" }];
    const ctx = makeCtx({
      horario: horario(true),
      horario_timezone: "UTC",
      horario_equipo: horarioEquipo,
    });
    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Con el equipo de turno.");
    const r1 = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);
    expect(ctx.metaClient.calls).toHaveLength(0);
    expect((await ctx.borradores.findActualByConversacion(r1.conversacionId))?.estado).toBe(
      "listo",
    );

    // El equipo ya se fue: el mensaje nuevo sale por la API y el borrador viejo cae.
    vi.setSystemTime(new Date("2026-09-30T20:00:00Z"));
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta automática de la noche.");
    await onMessageReceivedHandler({ parsed: parsed({ meta_message_id: "wamid.IN-2" }) }, ctx.deps);
    expect(ctx.metaClient.calls).toHaveLength(1);
    expect(await ctx.borradores.findActualByConversacion(r1.conversacionId)).toBeNull();

    // Vuelve el equipo al día siguiente: otra vez borrador.
    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("De nuevo con el equipo.");
    await onMessageReceivedHandler({ parsed: parsed({ meta_message_id: "wamid.IN-3" }) }, ctx.deps);
    expect(ctx.metaClient.calls).toHaveLength(1);
    expect((await ctx.borradores.findActualByConversacion(r1.conversacionId))?.contenido).toBe(
      "De nuevo con el equipo.",
    );
  });
});

describe("on-message-received — si la IA falla, la tarjeta no queda en 'Redactando…'", () => {
  test("un error del modelo deja el borrador en error con llm_error y el turno falla como siempre", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueue(async () => {
      throw new Error("el proveedor se cayó");
    });

    await expect(onMessageReceivedHandler({ parsed: parsed() }, ctx.deps)).rejects.toThrow(
      "el proveedor se cayó",
    );

    const conv = await conversacionDe(ctx);
    const b = await ctx.borradores.findActualByConversacion(conv.id);
    expect(b).toMatchObject({ estado: "error", error_codigo: "llm_error" });
    expect(JSON.stringify(b)).not.toContain("proveedor");
  });

  test("el tope diario de gasto deja el código tope_diario", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueue(async () => {
      throw new BudgetExceededError("tope diario alcanzado", "llm_diario");
    });

    await expect(onMessageReceivedHandler({ parsed: parsed() }, ctx.deps)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );

    const conv = await conversacionDe(ctx);
    expect((await ctx.borradores.findActualByConversacion(conv.id))?.error_codigo).toBe(
      "tope_diario",
    );
  });
});
