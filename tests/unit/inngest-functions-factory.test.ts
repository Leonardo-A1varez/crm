import { describe, expect, test } from "vitest";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
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
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DefaultTwinExtractorService } from "@/server/services/twin-extractor.service";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { InMemorySessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";
import { makeCrmInngestFunctions } from "@/inngest/functions";
import {
  FakeAgentLLM,
  FakeIntentBatchDetectorLLM,
  FakeIntentClassifierLLM,
  FakeTwinExtractorLLM,
} from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";
import { InMemoryLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.repo";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { InMemoryWorkflowsRepository } from "@/server/repositories/workflows.repo";
import { crearAccionesInternas } from "@/server/services/workflows/acciones/internas";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import { InMemoryMetaOperationalEventsRepository } from "@/server/repositories/meta-operational-events.repo";
import type { MotorDifusionService } from "@/server/services/difusion/motor.service";

/** El factory sólo arma funciones: el motor no se llama. */
const motorDeMentira: MotorDifusionService = {
  drenarLote: async () => ({ tipo: "sin_trabajo" }),
  verificarPlan: async () => true,
  aplicarEstadoWebhook: async () => false,
};

describe("makeCrmInngestFunctions", () => {
  test("produce 20 InngestFunction con IDs esperados", () => {
    const leads = new InMemoryLeadsRepository();
    const conversations = new InMemoryConversationsRepository();
    const sessions = new InMemoryLeadSessionRepository();
    const messages = new InMemoryMessagesRepository();
    const intents = new InMemoryIntentsRepository();
    const rules = new InMemoryRulesRepository();
    const productos = new InMemoryProductsRepository();
    const mergeCandidates = new InMemoryMergeCandidatesRepository();
    const identificadores = new InMemoryLeadIdentificadoresRepository();
    const outbox = new InMemoryEventOutboxRepository();

    const metaApi = new DefaultMetaApiService(conversations, messages, new FakeMetaApiClient());
    const intentClassifier = new DefaultIntentClassifierService(
      intents,
      new FakeIntentClassifierLLM(),
    );
    const ruleEngine = new DefaultRuleEngineService(
      intents,
      rules,
      new InMemoryReglasEtiquetaRepository(),
    );
    const catalog = new DefaultCatalogMatcherService(productos);
    const aiAgent = new DefaultAiAgentService(sessions, ruleEngine, catalog, new FakeAgentLLM());
    const twinExtractor = new DefaultTwinExtractorService(
      sessions,
      new FakeTwinExtractorLLM(),
      new InMemoryLeadVehiculosRepository(),
    );
    const handoff = new DefaultHandoffService(sessions);
    const mergeDetector = new DefaultLeadMergeDetectorService(
      leads,
      mergeCandidates,
      identificadores,
    );
    const tags = new InMemoryTagsRepository();
    const workflows = new InMemoryWorkflowsRepository();
    const workflowRuns = new InMemoryWorkflowRunsRepository();
    const registro = crearRegistro(crearAccionesInternas({ tags, sessions, handoff }));

    const fns = makeCrmInngestFunctions({
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
        ruleEngine,
        tags,
        intents,
        identificadores,
        supresiones: new InMemoryDifusionSupresionesRepository(),
        respuestaDifusion: { registrar: async () => null },
        plantillasSinSesion: { registrar: async () => 0 },
        configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
        emit: async () => {},
      },
      onStatusReceived: {
        messages,
        difusion: motorDeMentira,
        plantillasSinSesion: { aplicarEstadoMeta: async () => false },
      },
      onOperationalReceived: { eventos: new InMemoryMetaOperationalEventsRepository() },
      updateLeadTwin: { twinExtractor, sessions, emitirDisparo: async () => {} },
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
      recordatorioSeguimiento: { recordatorios: new InMemorySessionRecordatoriosRepository() },
      handoffNotification: {
        sessions,
        conversations,
        configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
        metaApi,
      },
      detectMergeCandidatesPerLead: { detector: mergeDetector },
      detectMergeCandidatesGlobal: { leads, detector: mergeDetector },
      dispatchOutboxEvents: { outbox, inngestEmit: async () => {} },
      workflowDisparar: {
        workflows,
        runs: workflowRuns,
        emitir: async () => {},
        emitirCancelacion: async () => {},
      },
      workflowSegmento: { runs: workflowRuns, workflows, registro },
      workflowProgramados: { workflows, sessions, leads },
      workflowInactividad: { workflows, sessions, conversations, messages, leads },
      drenarDifusiones: { motor: motorDeMentira },
      copilotoBorrador: {
        borradores: new InMemoryBorradoresIaRepository(),
        conversations,
        sessions,
        messages,
        turnClassifications: new InMemoryTurnClassificationsRepository(),
        intentClassifier,
        aiAgent,
        configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
      },
      recalcularCompatibilidad: {
        servicio: {
          recalcular: async () => ({ leidos: 0, actualizados: 0, sinVehiculo: 0, descartados: 0 }),
        },
      },
      sincronizarBodega: { servicio: null },
    });

    expect(fns).toHaveLength(21);
    const ids = fns.map((f) => f.id());
    expect(ids).toEqual(
      expect.arrayContaining([
        expect.stringContaining("on-message-received"),
        expect.stringContaining("on-status-received"),
        expect.stringContaining("on-operational-received"),
        expect.stringContaining("update-lead-twin"),
        expect.stringContaining("detect-intents.batch"),
        expect.stringContaining("auto-handoff"),
        expect.stringContaining("purge-old-sessions"),
        expect.stringContaining("reactivation-predictor"),
        expect.stringContaining("detect-merge-candidates-per-lead"),
        expect.stringContaining("detect-merge-candidates-global"),
        expect.stringContaining("dispatch-outbox-events"),
        expect.stringContaining("recordatorio-seguimiento"),
        expect.stringContaining("handoff-notification"),
        expect.stringContaining("workflow-disparar"),
        expect.stringContaining("workflow-segmento"),
        expect.stringContaining("workflow-programados"),
        expect.stringContaining("workflow-inactividad"),
        expect.stringContaining("drenar-difusiones"),
        expect.stringContaining("copiloto-borrador"),
        expect.stringContaining("recalcular-compatibilidad"),
        expect.stringContaining("sincronizar-bodega"),
      ]),
    );
  });
});
