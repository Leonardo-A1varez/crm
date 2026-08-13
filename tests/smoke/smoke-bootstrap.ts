/**
 * Smoke bootstrap helper — Slice 1 sub-paso 7.10.
 *
 * Construye `CrmInngestDeps` con InMemory* repos + spy metaClient + factory
 * `LLM_MODE=mock`. Permite ejercer pipeline end-to-end sin Supabase ni Meta
 * real ni OpenAI tokens.
 *
 * Diferencia vs `src/inngest/bootstrap.ts`:
 *   - Repos InMemory en lugar de Supabase
 *   - metaClient mock con `sendText` spy
 *   - LLM_MODE forzado "mock" (factory retorna InMemory* LLMs)
 *   - Logger NoopLogger (silent tests)
 *
 * Reusa mismo wireup pattern para validar que el shape de CrmInngestDeps
 * es satisfactible con impls in-memory (catch bugs interface drift).
 */

import { vi } from "vitest";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultLeadMergeDetectorService } from "@/server/services/lead-merge-detector.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DefaultTwinExtractorService } from "@/server/services/twin-extractor.service";

import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryEventOutboxRepository } from "@/server/repositories/event-outbox.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryReactivationDispatchesRepository } from "@/server/repositories/reactivation-dispatches.repo";
import { InMemorySessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryToolExecutionsRepository } from "@/server/repositories/tool-executions.repo";

import { InMemoryCostTracker } from "@/lib/observability/cost-tracker";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import { makeLlmFactory } from "@/server/services/llm/llm-factory";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";

import type { CrmInngestClient } from "@/inngest/client";
import type { CrmInngestDeps } from "@/inngest/functions";
import type {
  MetaApiClient,
  MetaSendResult,
  MetaSendTextInput,
} from "@/server/services/meta-api.service";

import { makeEmitForOnMessageReceived, makeInngestEmitForOutbox } from "@/inngest/callbacks/emit";
import { makePurgeSession } from "@/inngest/callbacks/purge-session";
import { makeSendReactivation } from "@/inngest/callbacks/send-reactivation";

export interface SmokeBundle {
  deps: CrmInngestDeps;
  /** Spy en sendText. Captura outbound messages. */
  metaClientSend: ReturnType<typeof vi.fn>;
  /** Spy en inngest.send. Captura emitted events. */
  inngestSend: ReturnType<typeof vi.fn>;
  /** Repos InMemory accesibles para asserts state post-pipeline. */
  repos: {
    leads: InMemoryLeadsRepository;
    conversations: InMemoryConversationsRepository;
    sessions: InMemoryLeadSessionRepository;
    messages: InMemoryMessagesRepository;
    intents: InMemoryIntentsRepository;
    rules: InMemoryRulesRepository;
    productos: InMemoryProductsRepository;
  };
  logger: Logger;
}

/**
 * Mock MetaApiClient — captura sendText calls + retorna deterministic id.
 * Inyectable en DefaultMetaApiService (interfaz `MetaApiClient`).
 */
function makeMockMetaClient(): { client: MetaApiClient; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async (_input: MetaSendTextInput): Promise<MetaSendResult> => {
    return { meta_message_id: `mock.outbound.${Date.now()}.${Math.random()}` };
  });
  return {
    client: { sendText: send },
    send,
  };
}

/**
 * Mock InngestClient — captura send calls. No corre handlers reales (smoke
 * test cubre wireup + emit shape, no ejecución de functions).
 */
function makeMockInngest(): { client: CrmInngestClient; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn().mockResolvedValue(undefined);
  return {
    client: { send } as unknown as CrmInngestClient,
    send,
  };
}

export function makeSmokeBundle(): SmokeBundle {
  const logger: Logger = new NoopLogger();

  // ===== InMemory Repositories =====
  const leads = new InMemoryLeadsRepository();
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const productos = new InMemoryProductsRepository();
  const reactivationDispatches = new InMemoryReactivationDispatchesRepository();
  const recordatorios = new InMemorySessionRecordatoriosRepository();
  const mergeCandidates = new InMemoryMergeCandidatesRepository();
  const eventOutbox = new InMemoryEventOutboxRepository();
  const toolExecutions = new InMemoryToolExecutionsRepository();

  // ===== Infrastructure =====
  const costTracker = new InMemoryCostTracker({
    pricing: OPENAI_PRICING,
    dailyCapUsd: 10,
  });

  // LLM_MODE=mock — factory retorna InMemory* LLMs deterministic.
  const llmBundle = makeLlmFactory({
    mode: "mock",
    costTracker,
  });

  // ===== Mock Meta + Inngest clients =====
  const { client: metaClient, send: metaClientSend } = makeMockMetaClient();
  const { client: inngestClient, send: inngestSend } = makeMockInngest();

  // ===== Services Default impls (DI repos + LLMs) =====
  const catalog = new DefaultCatalogMatcherService(productos);
  const ruleEngine = new DefaultRuleEngineService(intents, rules);
  const intentClassifier = new DefaultIntentClassifierService(intents, llmBundle.intentClassifier);
  const twinExtractor = new DefaultTwinExtractorService(sessions, llmBundle.twinExtractor);
  const handoff = new DefaultHandoffService(sessions);
  const metaApi = new DefaultMetaApiService(conversations, messages, metaClient);
  const mergeDetector = new DefaultLeadMergeDetectorService(leads, mergeCandidates);
  const aiAgent = new DefaultAiAgentService(
    sessions,
    ruleEngine,
    catalog,
    llmBundle.agent,
    undefined,
    toolExecutions,
  );

  // ===== Callbacks =====
  const emit = makeEmitForOnMessageReceived(inngestClient);
  const inngestEmit = makeInngestEmitForOutbox(inngestClient);
  const purgeSession = makePurgeSession({
    sessions,
    messages,
    removeMedia: async () => {},
    logger,
  });
  const sendReactivation = makeSendReactivation({
    leads,
    sessions,
    convs: conversations,
    metaApi,
    logger,
  });

  // ===== CrmInngestDeps wireup =====
  const deps: CrmInngestDeps = {
    onMessageReceived: {
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
      recordatorios,
      configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
      emit,
      logger,
    },
    onStatusReceived: { messages },
    updateLeadTwin: { twinExtractor },
    detectIntentsBatch: {
      sessions,
      conversations,
      messages,
      intents,
      detector: llmBundle.intentBatchDetector,
    },
    autoHandoff: { handoff },
    purgeOldSessions: { sessions, purgeSession },
    reactivationPredictor: {
      sessions,
      dispatches: reactivationDispatches,
      sendReactivation,
    },
    recordatorioSeguimiento: { recordatorios, logger },
    handoffNotification: {
      sessions,
      conversations,
      configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
      metaApi,
      logger,
    },
    detectMergeCandidatesPerLead: { detector: mergeDetector, logger },
    detectMergeCandidatesGlobal: { leads, detector: mergeDetector, logger },
    dispatchOutboxEvents: { outbox: eventOutbox, inngestEmit, logger },
  };

  return {
    deps,
    metaClientSend,
    inngestSend,
    repos: { leads, conversations, sessions, messages, intents, rules, productos },
    logger,
  };
}
