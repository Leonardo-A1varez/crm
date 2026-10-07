import { describe, expect, test } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { InfraError } from "@/lib/errors";
import {
  onMessageReceivedHandler,
  type EmittedEvent,
  type OnMessageReceivedDeps,
} from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import type { LogContext, Logger } from "@/lib/observability/logger";
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
import type { ModoOverride } from "@/types/copiloto";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

// El "escribiendo…" de WhatsApp (typing_indicator de la Cloud API): solo se pide
// cuando el agente va a contestar por la API. Meta recomienda no mostrarlo si no
// se va a responder, y si lo vemos sin respuesta el cliente espera en vano.

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

class SpyLogger implements Logger {
  readonly warns: { msg: string; ctx: LogContext }[] = [];
  debug(): void {}
  info(): void {}
  warn(msg: string, ctx: LogContext = {}): void {
    this.warns.push({ msg, ctx });
  }
  error(): void {}
  child(): Logger {
    return this;
  }
}

function makeCtx() {
  const leads = new InMemoryLeadsRepository();
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const intentLLM = new FakeIntentClassifierLLM();
  const agentLLM = new FakeAgentLLM();
  const metaClient = new FakeMetaApiClient();
  const logger = new SpyLogger();
  const borradores = new InMemoryBorradoresIaRepository(async (conversacionId) => {
    const entrantes = (await messages.listByConversacion(conversacionId, { limit: 200 })).filter(
      (m) => m.direction === "in",
    );
    return entrantes.at(-1)?.id ?? null;
  });
  const ruleEngine = new DefaultRuleEngineService(
    intents,
    rules,
    new InMemoryReglasEtiquetaRepository(),
  );
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
    ruleExecutions: new InMemoryRuleExecutionsRepository(),
    turnClassifications: new InMemoryTurnClassificationsRepository(),
    ruleEngine,
    tags: new InMemoryTagsRepository(),
    intents,
    identificadores: new InMemoryLeadIdentificadoresRepository(),
    supresiones: new InMemoryDifusionSupresionesRepository(),
    respuestaDifusion: { registrar: async () => null },
    plantillasSinSesion: { registrar: async () => 0 },
    borradores,
    configProvider: new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA }),
    logger,
    emit: async (e) => {
      emitted.push(e);
    },
  };
  return { deps, leads, conversations, sessions, intentLLM, agentLLM, metaClient, logger };
}
type Ctx = ReturnType<typeof makeCtx>;

async function conversacion(ctx: Ctx, modo: ModoOverride | null, canal: "wa" | "ig" = "wa") {
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
    canal_origen: canal,
    meta_user_ids: { [canal]: TEL },
  });
  const conv = await ctx.conversations.create({
    lead_id: lead.id,
    canal,
    canal_thread_id: TEL,
  });
  await ctx.conversations.update(conv.id, { modo_respuesta_override: modo });
  return lead;
}

async function sesionEnManosDeUnaPersona(
  ctx: Ctx,
  lead: Awaited<ReturnType<typeof conversacion>>,
  cambios: { ia_pausada: boolean; current_stage: "nuevo" | "requiere_humano" },
) {
  await ctx.sessions.create({
    lead_id: lead.id,
    current_stage: cambios.current_stage,
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
    ia_pausada: cambios.ia_pausada,
  });
}

describe("on-message-received — indicador «escribiendo…» de WhatsApp", () => {
  test("turno que contesta el agente: se pide una vez, con el id del mensaje entrante", async () => {
    const ctx = makeCtx();
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Sí, tenemos filtros de aceite.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(r.sent).toBe(true);
    expect(ctx.metaClient.typingCalls).toEqual([{ messageId: "wamid.IN-1" }]);
  });

  test("sesión con la IA pausada: no se pide", async () => {
    const ctx = makeCtx();
    const lead = await conversacion(ctx, null);
    await sesionEnManosDeUnaPersona(ctx, lead, { ia_pausada: true, current_stage: "nuevo" });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(r.sent).toBe(false);
    expect(ctx.metaClient.typingCalls).toHaveLength(0);
  });

  test("sesión en requiere_humano: no se pide", async () => {
    const ctx = makeCtx();
    const lead = await conversacion(ctx, null);
    await sesionEnManosDeUnaPersona(ctx, lead, {
      ia_pausada: false,
      current_stage: "requiere_humano",
    });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("no debería salir");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.typingCalls).toHaveLength(0);
  });

  test("modo Copiloto (borrador, nada sale por la API): no se pide", async () => {
    const ctx = makeCtx();
    await conversacion(ctx, "copiloto");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Borrador.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(r.sent).toBe(false);
    expect(ctx.metaClient.typingCalls).toHaveLength(0);
  });

  test("Instagram: no se pide (el indicador es de la Cloud API de WhatsApp)", async () => {
    const ctx = makeCtx();
    await conversacion(ctx, null, "ig");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Hola.");

    await onMessageReceivedHandler({ parsed: parsed({ canal: "ig" }) }, ctx.deps);

    expect(ctx.metaClient.typingCalls).toHaveLength(0);
  });

  test("si Meta rechaza el indicador, el turno contesta igual y queda un warning sin datos del cliente", async () => {
    const ctx = makeCtx();
    ctx.metaClient.typingFailWith = new InfraError("Meta wa.typingIndicator HTTP 500", "meta");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Sí, tenemos filtros de aceite.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(r.sent).toBe(true);
    expect(ctx.metaClient.calls).toHaveLength(1);
    const aviso = ctx.logger.warns.find((w) => w.msg === "typing-indicator-fallo");
    expect(aviso).toBeDefined();
    expect(JSON.stringify(aviso?.ctx)).not.toContain(TEL);
    expect(JSON.stringify(aviso?.ctx)).not.toContain("filtro");
  });
});
