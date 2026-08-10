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
  type StepRunner,
} from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

class SpyStepRunner implements StepRunner {
  public readonly steps: string[] = [];

  async run<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.steps.push(name);
    return fn();
  }
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
    configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
    emit,
  };

  return { deps, emitted, metaClient, intentLLM, agentLLM, intents, rules };
}

describe("onMessageReceivedHandler granular steps", () => {
  let ctx: ReturnType<typeof makeDeps>;
  let spy: SpyStepRunner;

  beforeEach(() => {
    ctx = makeDeps();
    spy = new SpyStepRunner();
  });

  test("flujo normal LLM ejecuta steps en orden (lead nuevo emite lead/created)", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps, spy);

    expect(spy.steps).toEqual([
      "dedup",
      "resolve-lead",
      "emit-lead-created",
      "upsert-conv",
      "resolve-session",
      "record-inbound",
      "classify",
      "build-turn",
      "respond",
      // El turno lo resolvió el LLM (`source === "llm"`): se audita antes de
      // mandar, porque el modelo ya corrió y ya se pagó aunque el envío falle.
      "auditar-clasificacion",
      "send",
      "emit-turn",
      "emit-handoff-eval",
    ]);
    expect(ctx.emitted.some((e) => e.name === "lead/created")).toBe(true);
  });

  test("duplicate short-circuits tras record-inbound: skip classify/respond/send/emit", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta-1");

    // Primer turno completo.
    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps, new SpyStepRunner());

    // Segundo turno mismo meta_message_id = duplicate. Lead ya existe → sin emit-lead-created.
    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps, spy);

    expect(spy.steps).toEqual([
      "dedup",
      "resolve-lead",
      "upsert-conv",
      "resolve-session",
      "record-inbound",
    ]);
  });

  test("agent source=handoff: skip send pero ejecuta emit", async () => {
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
      respuesta_contenido: "humano",
      prioridad: 0,
      activa: true,
    });

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps, spy);

    expect(spy.steps).toEqual([
      "dedup",
      "resolve-lead",
      "emit-lead-created",
      "upsert-conv",
      "resolve-session",
      "record-inbound",
      "classify",
      "build-turn",
      "respond",
      // sin "send"
      "emit-turn",
      "emit-handoff-eval",
    ]);
  });

  test("steps son llamados con nombre único (memoización Inngest)", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("x");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps, spy);

    const unique = new Set(spy.steps);
    expect(unique.size).toBe(spy.steps.length);
  });
});
