import { describe, expect, test, vi } from "vitest";
import type { AppEnv } from "@/lib/env";
import type { AppClient } from "@/server/db/client";
import type { CrmInngestClient } from "@/inngest/client";
import { makeInngestDeps } from "@/inngest/bootstrap";

/**
 * Tests bootstrap construction (7.8). Mock `AppClient` cast a {} as never
 * — wireup solo construye instances (no DB calls). Verificar shape + LLM mode
 * selector.
 */

const FAKE_DB = {} as AppClient;
const FAKE_INNGEST = {
  send: vi.fn().mockResolvedValue(undefined),
} as unknown as CrmInngestClient;

function makeTestEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    INNGEST_EVENT_KEY: "test-event-key",
    INNGEST_SIGNING_KEY: "test-signing-key",
    OPENAI_API_KEY: "sk-test",
    META_APP_SECRET: "test-meta-secret",
    META_VERIFY_TOKEN: "test-verify",
    META_WHATSAPP_PHONE_NUMBER_ID: "0",
    META_WHATSAPP_ACCESS_TOKEN: "test-token",
    META_GRAPH_API_VERSION: "v21.0",
    META_IG_PAGE_ID: undefined,
    META_IG_ACCESS_TOKEN: undefined,
    META_FB_PAGE_ID: undefined,
    META_FB_PAGE_ACCESS_TOKEN: undefined,
    LLM_DAILY_CAP_USD: 10,
    LLM_MODE: "mock",
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
    ...overrides,
  };
}

describe("makeInngestDeps — shape", () => {
  test("retorna { deps, llmBundle, logger }", () => {
    const result = makeInngestDeps({ env: makeTestEnv(), db: FAKE_DB, inngest: FAKE_INNGEST });
    expect(result.deps).toBeDefined();
    expect(result.llmBundle).toBeDefined();
    expect(result.logger).toBeDefined();
  });

  test("deps cubre las 9 Inngest functions", () => {
    const { deps } = makeInngestDeps({
      env: makeTestEnv(),
      db: FAKE_DB,
      inngest: FAKE_INNGEST,
    });
    expect(deps.onMessageReceived).toBeDefined();
    expect(deps.updateLeadTwin).toBeDefined();
    expect(deps.detectIntentsBatch).toBeDefined();
    expect(deps.autoHandoff).toBeDefined();
    expect(deps.purgeOldSessions).toBeDefined();
    expect(deps.reactivationPredictor).toBeDefined();
    expect(deps.detectMergeCandidatesPerLead).toBeDefined();
    expect(deps.detectMergeCandidatesGlobal).toBeDefined();
    expect(deps.dispatchOutboxEvents).toBeDefined();
  });

  test("onMessageReceived recibe 4 repos + 3 services + emit + logger", () => {
    const { deps } = makeInngestDeps({
      env: makeTestEnv(),
      db: FAKE_DB,
      inngest: FAKE_INNGEST,
    });
    expect(deps.onMessageReceived.leads.constructor.name).toBe("SupabaseLeadsRepository");
    expect(deps.onMessageReceived.conversations.constructor.name).toBe(
      "SupabaseConversationsRepository",
    );
    expect(deps.onMessageReceived.sessions.constructor.name).toBe("SupabaseLeadSessionRepository");
    expect(deps.onMessageReceived.messages.constructor.name).toBe("SupabaseMessagesRepository");
    expect(deps.onMessageReceived.metaApi.constructor.name).toBe("DefaultMetaApiService");
    expect(deps.onMessageReceived.intentClassifier.constructor.name).toBe(
      "DefaultIntentClassifierService",
    );
    expect(deps.onMessageReceived.aiAgent.constructor.name).toBe("DefaultAiAgentService");
    expect(typeof deps.onMessageReceived.emit).toBe("function");
    expect(deps.onMessageReceived.logger).toBeDefined();
  });
});

describe("makeInngestDeps — LLM_MODE selector", () => {
  test("LLM_MODE=mock → llmBundle InMemory* impls", () => {
    const { llmBundle } = makeInngestDeps({
      env: makeTestEnv({ LLM_MODE: "mock" }),
      db: FAKE_DB,
      inngest: FAKE_INNGEST,
    });
    expect(llmBundle.intentClassifier.constructor.name).toBe("InMemoryIntentClassifierLLM");
    expect(llmBundle.twinExtractor.constructor.name).toBe("InMemoryTwinExtractorLLM");
    expect(llmBundle.conversationSummarizer.constructor.name).toBe(
      "InMemoryConversationSummarizerLLM",
    );
    expect(llmBundle.intentBatchDetector.constructor.name).toBe("InMemoryIntentBatchDetectorLLM");
    expect(llmBundle.agent.constructor.name).toBe("InMemoryAgentLLM");
  });

  test("LLM_MODE=real → llmBundle OpenAi* impls", () => {
    const { llmBundle } = makeInngestDeps({
      env: makeTestEnv({ LLM_MODE: "real", OPENAI_API_KEY: "sk-real-fake" }),
      db: FAKE_DB,
      inngest: FAKE_INNGEST,
    });
    expect(llmBundle.intentClassifier.constructor.name).toBe("OpenAiIntentClassifierLLM");
    expect(llmBundle.agent.constructor.name).toBe("OpenAiAgentLLM");
  });
});

describe("makeInngestDeps — callbacks", () => {
  test("emit callback delega a inngest.send con shape correcto", async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    const inngestMock = { send: sendMock } as unknown as CrmInngestClient;
    const { deps } = makeInngestDeps({
      env: makeTestEnv(),
      db: FAKE_DB,
      inngest: inngestMock,
    });
    await deps.onMessageReceived.emit({
      name: "lead/created",
      data: { leadId: "00000000-0000-0000-0000-000000000001", canal: "wa" },
    });
    expect(sendMock).toHaveBeenCalledWith({
      name: "lead/created",
      data: { leadId: "00000000-0000-0000-0000-000000000001", canal: "wa" },
    });
  });

  test("dispatchOutboxEvents.inngestEmit delega a inngest.send + propaga id", async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    const inngestMock = { send: sendMock } as unknown as CrmInngestClient;
    const { deps } = makeInngestDeps({
      env: makeTestEnv(),
      db: FAKE_DB,
      inngest: inngestMock,
    });
    await deps.dispatchOutboxEvents.inngestEmit({
      name: "lead/created",
      data: { leadId: "x" },
      id: "dedup-key-123",
    });
    expect(sendMock).toHaveBeenCalledWith({
      name: "lead/created",
      data: { leadId: "x" },
      id: "dedup-key-123",
    });
  });

  test("purgeSession real queda wireada (función construida)", () => {
    // Ejecución real cubierta en purge-session-callback.test.ts (InMemory).
    // Acá solo shape: FAKE_DB no soporta queries.
    const { deps } = makeInngestDeps({
      env: makeTestEnv(),
      db: FAKE_DB,
      inngest: FAKE_INNGEST,
    });
    expect(typeof deps.purgeOldSessions.purgeSession).toBe("function");
  });

  test("sendReactivation real queda wireada (función construida)", () => {
    // Ejecución real cubierta en send-reactivation-callback.test.ts (InMemory).
    const { deps } = makeInngestDeps({
      env: makeTestEnv(),
      db: FAKE_DB,
      inngest: FAKE_INNGEST,
    });
    expect(typeof deps.reactivationPredictor.sendReactivation).toBe("function");
  });
});
