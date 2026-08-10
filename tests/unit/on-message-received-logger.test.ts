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
} from "@/inngest/functions/on-message-received";
import type { Logger, LogContext } from "@/lib/observability/logger";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

type LogEntry = { level: string; msg: string; ctx: LogContext };

class SpyLogger implements Logger {
  public entries: LogEntry[];
  private readonly bindings: LogContext;

  constructor(bindings: LogContext = {}, sharedEntries?: LogEntry[]) {
    this.bindings = bindings;
    this.entries = sharedEntries ?? [];
  }

  debug(msg: string, ctx?: LogContext): void {
    this.entries.push({ level: "debug", msg, ctx: { ...this.bindings, ...(ctx ?? {}) } });
  }
  info(msg: string, ctx?: LogContext): void {
    this.entries.push({ level: "info", msg, ctx: { ...this.bindings, ...(ctx ?? {}) } });
  }
  warn(msg: string, ctx?: LogContext): void {
    this.entries.push({ level: "warn", msg, ctx: { ...this.bindings, ...(ctx ?? {}) } });
  }
  error(msg: string, ctx?: LogContext): void {
    this.entries.push({ level: "error", msg, ctx: { ...this.bindings, ...(ctx ?? {}) } });
  }
  child(bindings: LogContext): Logger {
    return new SpyLogger({ ...this.bindings, ...bindings }, this.entries);
  }

  msgs(): string[] {
    return this.entries.map((e) => e.msg);
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
    raw: { type: "text" },
    ...overrides,
  };
}

function makeDeps(logger?: Logger) {
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
    logger,
  };

  return { deps, emitted, metaClient, intentLLM, agentLLM, intents, rules };
}

describe("onMessageReceivedHandler logger", () => {
  let logger: SpyLogger;
  let ctx: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    logger = new SpyLogger();
    ctx = makeDeps(logger);
  });

  test("emite pipeline-start + pipeline-complete en flow normal", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("hola");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const msgs = logger.msgs();
    expect(msgs).toContain("pipeline-start");
    expect(msgs).toContain("pipeline-complete");
  });

  test("emite lead-created + session-created en primer turno", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("hola");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const msgs = logger.msgs();
    expect(msgs).toContain("lead-created");
    expect(msgs).toContain("session-created");
  });

  test("emite dedup-hit en webhook duplicado", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("first");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const dupLogger = new SpyLogger();
    const dupCtx = { ...ctx.deps, logger: dupLogger };
    await onMessageReceivedHandler({ parsed: parsed() }, dupCtx);

    expect(dupLogger.msgs()).toContain("dedup-hit");
  });

  test("emite agent-decision con source + send-out cuando agente responde", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("respuesta");

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const decision = logger.entries.find((e) => e.msg === "agent-decision");
    expect(decision).toBeDefined();
    expect(decision!.ctx.source).toBe("llm");

    expect(logger.msgs()).toContain("send-out");
  });

  test("emite send-skipped cuando agent handoff", async () => {
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

    await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(logger.msgs()).toContain("send-skipped");
    expect(logger.msgs()).not.toContain("send-out");
  });

  test("emite pipeline-error en falla y propaga", async () => {
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    // sin enqueue agente → falla en respond step

    await expect(onMessageReceivedHandler({ parsed: parsed() }, ctx.deps)).rejects.toThrow();

    const errEntry = logger.entries.find((e) => e.msg === "pipeline-error");
    expect(errEntry).toBeDefined();
    expect(errEntry!.level).toBe("error");
  });
});
