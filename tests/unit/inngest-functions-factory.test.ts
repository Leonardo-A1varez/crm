import { describe, expect, test } from "vitest";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryEventOutboxRepository } from "@/server/repositories/event-outbox.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultLeadMergeDetectorService } from "@/server/services/lead-merge-detector.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DefaultTwinExtractorService } from "@/server/services/twin-extractor.service";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { makeCrmInngestFunctions } from "@/inngest/functions";
import {
  FakeAgentLLM,
  FakeIntentBatchDetectorLLM,
  FakeIntentClassifierLLM,
  FakeTwinExtractorLLM,
} from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

describe("makeCrmInngestFunctions", () => {
  test("produce 9 InngestFunction con IDs esperados", () => {
    const leads = new InMemoryLeadsRepository();
    const conversations = new InMemoryConversationsRepository();
    const sessions = new InMemoryLeadSessionRepository();
    const messages = new InMemoryMessagesRepository();
    const intents = new InMemoryIntentsRepository();
    const rules = new InMemoryRulesRepository();
    const productos = new InMemoryProductsRepository();
    const mergeCandidates = new InMemoryMergeCandidatesRepository();
    const outbox = new InMemoryEventOutboxRepository();

    const metaApi = new DefaultMetaApiService(conversations, messages, new FakeMetaApiClient());
    const intentClassifier = new DefaultIntentClassifierService(
      intents,
      new FakeIntentClassifierLLM(),
    );
    const ruleEngine = new DefaultRuleEngineService(intents, rules);
    const catalog = new DefaultCatalogMatcherService(productos);
    const aiAgent = new DefaultAiAgentService(sessions, ruleEngine, catalog, new FakeAgentLLM());
    const twinExtractor = new DefaultTwinExtractorService(sessions, new FakeTwinExtractorLLM());
    const handoff = new DefaultHandoffService(sessions);
    const mergeDetector = new DefaultLeadMergeDetectorService(leads, mergeCandidates);

    const fns = makeCrmInngestFunctions({
      onMessageReceived: {
        leads,
        conversations,
        sessions,
        messages,
        metaApi,
        intentClassifier,
        aiAgent,
        configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
        emit: async () => {},
      },
      updateLeadTwin: { twinExtractor },
      detectIntentsBatch: {
        sessions,
        conversations,
        messages,
        intents,
        detector: new FakeIntentBatchDetectorLLM(),
      },
      autoHandoff: { handoff },
      purgeOldSessions: { sessions, purgeSession: async () => {} },
      reactivationPredictor: { sessions, sendReactivation: async () => {} },
      detectMergeCandidatesPerLead: { detector: mergeDetector },
      detectMergeCandidatesGlobal: { leads, detector: mergeDetector },
      dispatchOutboxEvents: { outbox, inngestEmit: async () => {} },
    });

    expect(fns).toHaveLength(9);
    const ids = fns.map((f) => f.id());
    expect(ids).toEqual(
      expect.arrayContaining([
        expect.stringContaining("on-message-received"),
        expect.stringContaining("update-lead-twin"),
        expect.stringContaining("detect-intents.batch"),
        expect.stringContaining("auto-handoff"),
        expect.stringContaining("purge-old-sessions"),
        expect.stringContaining("reactivation-predictor"),
        expect.stringContaining("detect-merge-candidates-per-lead"),
        expect.stringContaining("detect-merge-candidates-global"),
        expect.stringContaining("dispatch-outbox-events"),
      ]),
    );
  });
});
