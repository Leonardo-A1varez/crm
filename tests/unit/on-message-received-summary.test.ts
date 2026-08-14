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
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import {
  onMessageReceivedHandler,
  type EmittedEvent,
  type OnMessageReceivedDeps,
} from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

function parsed(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    canal_thread_id: "549110",
    meta_user_id: "549110",
    meta_message_id: "wamid.IN-X",
    tipo: "text",
    contenido: "ultima pregunta",
    media_url: null,
    nombre_perfil: null,
    raw: { type: "text" },
    ...overrides,
  };
}

function makeDeps() {
  const leads = new InMemoryLeadsRepository();
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const productos = new InMemoryProductsRepository();

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
    ruleExecutions: new InMemoryRuleExecutionsRepository(),
    turnClassifications: new InMemoryTurnClassificationsRepository(),
    intents,
    identificadores: new InMemoryLeadIdentificadoresRepository(),
    configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
    emit,
  };

  return { deps, leads, conversations, sessions, messages, intentLLM, agentLLM };
}

describe("buildConversationTurn con context_summary", () => {
  let ctx: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeDeps();
  });

  test("session.context_summary null → turn solo mensajes", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const call = ctx.agentLLM.calls[0];
    expect(call.conversationTurn[0]).not.toMatch(/\[Resumen previo\]/);
  });

  test("session.context_summary set → turn prefijado con [Resumen previo]", async () => {
    // Seed lead + active session con summary previo
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
      current_stage: "negociando",
      urgencia: "alta",
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
      context_summary: "Lead Corolla 2018 quería pastillas, ofreció contraoferta -10%.",
    });

    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("ok");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const call = ctx.agentLLM.calls[0];
    expect(call.conversationTurn[0]).toBe(
      "[Resumen previo]: Lead Corolla 2018 quería pastillas, ofreció contraoferta -10%.",
    );
    expect(call.conversationTurn.length).toBeGreaterThan(1);
  });
});
