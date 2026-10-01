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
import { AvisarEquipoService } from "@/server/services/workflows/avisar-equipo.service";
import { InMemoryNotificacionesRepository } from "@/server/repositories/notificaciones.repo";
import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { InMemoryHandoffEventsRepository } from "@/server/repositories/handoff-events.repo";
import { InMemoryLlmUsageRepository } from "@/server/repositories/llm-usage.repo";
import { crearPuertosDelegacion } from "@/server/services/workflows/puertos-delegacion";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultLeadMergeDetectorService } from "@/server/services/lead-merge-detector.service";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { InMemoryLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.repo";
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
import { InMemoryUsersRepository } from "@/server/repositories/users.repo";

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

import {
  makeEmitForOnMessageReceived,
  makeEmitirDisparoWorkflow,
  makeInngestEmitForOutbox,
} from "@/inngest/callbacks/emit";
import { makePurgeSession } from "@/inngest/callbacks/purge-session";
import { makeSendReactivation } from "@/inngest/callbacks/send-reactivation";
import {
  makeAvisosDeAsignacion,
  makeConversationsParaEnviarMensaje,
} from "@/inngest/callbacks/workflow-adapters";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { InMemoryWorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { ConfigProviderParaEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";
import { crearRegistroDeAcciones } from "@/server/services/workflows/acciones/registro";
import { InMemoryWorkflowPlantillasSinSesionRepository } from "@/server/repositories/workflow-plantillas-sin-sesion.repo";
import {
  DefaultAnotarPlantillasSinSesion,
  DefaultEnvioPlantillaSinSesion,
} from "@/server/services/workflows/plantilla-sin-sesion.service";
import { InMemorySessionLock } from "@/server/lock/session-lock";
import { DefaultAsignacionService } from "@/server/services/asignacion/asignacion.service";
import { DefaultUsuariosService } from "@/server/services/usuarios/usuarios.service";
import { InMemoryMetaOperationalEventsRepository } from "@/server/repositories/meta-operational-events.repo";
import { InMemoryDifusionEnviosRepository } from "@/server/repositories/difusion-envios.repo";
import { InMemoryDifusionesRepository } from "@/server/repositories/difusiones.repo";
import { DefaultRespuestaDifusionService } from "@/server/services/difusion/respuesta.service";
import { DefaultMotorDifusionService } from "@/server/services/difusion/motor.service";
import { cargarDatosDelLeadParaDifusion } from "@/server/services/difusion/datos-lead";

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
    client: {
      sendText: send,
      sendTemplate: async () => {
        throw new Error("el smoke no manda plantillas");
      },
      sendRico: async () => {
        throw new Error("el smoke no manda botones, listas, imágenes ni ubicaciones");
      },
    },
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
  const identificadores = new InMemoryLeadIdentificadoresRepository();
  const vehiculos = new InMemoryLeadVehiculosRepository();
  const eventOutbox = new InMemoryEventOutboxRepository();
  const toolExecutions = new InMemoryToolExecutionsRepository();
  const tags = new InMemoryTagsRepository();
  const workflows = new InMemoryWorkflowsRepository();
  const workflowRuns = new InMemoryWorkflowRunsRepository();
  const users = new InMemoryUsersRepository();

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
  const ruleEngine = new DefaultRuleEngineService(
    intents,
    rules,
    new InMemoryReglasEtiquetaRepository(),
  );
  const intentClassifier = new DefaultIntentClassifierService(intents, llmBundle.intentClassifier);
  const twinExtractor = new DefaultTwinExtractorService(
    sessions,
    llmBundle.twinExtractor,
    vehiculos,
  );
  const handoffEvents = new InMemoryHandoffEventsRepository(sessions);
  const handoff = new DefaultHandoffService(sessions, undefined, handoffEvents);
  const metaApi = new DefaultMetaApiService(conversations, messages, metaClient);
  const mergeDetector = new DefaultLeadMergeDetectorService(
    leads,
    mergeCandidates,
    identificadores,
  );
  const aiAgent = new DefaultAiAgentService(
    sessions,
    ruleEngine,
    catalog,
    llmBundle.agent,
    undefined,
    toolExecutions,
  );

  // ===== Motor de workflows (W2/Task 10) =====
  const configProviderParaEnviarMensaje: ConfigProviderParaEnviarMensaje = {
    activa: () => Promise.resolve(CONFIG_DE_FABRICA),
  };
  // La misma lista de bajas para la baja por palabra y para `enviar_mensaje`,
  // como en producción (`inngest/bootstrap.ts`).
  const supresiones = new InMemoryDifusionSupresionesRepository();
  // El mismo motor que producción, con repos en memoria y el Meta de mentira.
  const difusiones = new InMemoryDifusionesRepository();
  const difusionEnvios = new InMemoryDifusionEnviosRepository();
  const respuestaDifusion = new DefaultRespuestaDifusionService({
    envios: difusionEnvios,
    difusiones,
    messages,
    sessions,
  });
  const motorDifusion = new DefaultMotorDifusionService({
    difusiones,
    envios: difusionEnvios,
    supresiones,
    usoCupoDesde: async () => 0,
    meta: metaClient,
    metaApi,
    hiloActivo: async () => null,
    // Sin resolver de audiencia en memoria (lo resuelve el SQL): la re-evaluación no suma a nadie.
    altas: { sumar: async () => ({ coinciden: 0, nuevos: 0, sumadas: 0 }) },
    leerTopeMensajeria: async () => ({ estado: "ok", tope: 250 }),
    datosDelLead: (leadId, campos) =>
      cargarDatosDelLeadParaDifusion({ leads, vehiculos, sessions }, leadId, campos),
    estadoConversacional: async () => new Map(),
    esperar: async () => {},
    logger,
  });
  const plantillasSinSesionRepo = new InMemoryWorkflowPlantillasSinSesionRepository();
  const registroDeAcciones = crearRegistroDeAcciones({
    plantillasSinSesion: new DefaultEnvioPlantillaSinSesion({
      repo: plantillasSinSesionRepo,
      meta: metaClient,
    }),
    tags,
    sessions,
    handoff,
    messages,
    metaApi,
    conversations: makeConversationsParaEnviarMensaje({ conversations, messages }),
    leads,
    users,
    configProvider: configProviderParaEnviarMensaje,
    supresiones,
    imagenesDeFlujo: { urlFirmada: async (ruta) => `smoke://mensajes_media/${ruta}` },
    asignacion: new DefaultAsignacionService({
      sessions,
      usuarios: new DefaultUsuariosService({ users }),
    }),
    avisos: makeAvisosDeAsignacion(makeEmitirDisparoWorkflow(inngestClient)),
    candadoReparto: new InMemorySessionLock(),
    avisarEquipo: new AvisarEquipoService({
      users,
      sessions,
      conversations: makeConversationsParaEnviarMensaje({ conversations, messages }),
      notificaciones: new InMemoryNotificacionesRepository(),
    }),
    // "Delegar al agente": en el smoke no hay gasto registrado ni campos vivos.
    ...crearPuertosDelegacion({
      handoffEvents,
      llmUsage: new InMemoryLlmUsageRepository(),
      config: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
    }),
    camposVivos: { cargar: async () => ({}), zona: async () => "UTC" },
  });

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
      ruleEngine,
      tags,
      intents,
      identificadores,
      supresiones,
      respuestaDifusion,
      plantillasSinSesion: new DefaultAnotarPlantillasSinSesion({
        repo: plantillasSinSesionRepo,
        messages,
      }),
      recordatorios,
      configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
      emit,
      logger,
    },
    onStatusReceived: {
      messages,
      difusion: motorDifusion,
      plantillasSinSesion: plantillasSinSesionRepo,
    },
    onOperationalReceived: { eventos: new InMemoryMetaOperationalEventsRepository() },
    updateLeadTwin: {
      twinExtractor,
      sessions,
      emitirDisparo: makeEmitirDisparoWorkflow(inngestClient),
    },
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
    workflowDisparar: {
      workflows,
      runs: workflowRuns,
      emitir: async ({ runId, desdePaso }) => {
        await inngestClient.send({
          name: "workflow/segmento.pendiente",
          data: { runId, desdePaso },
        });
      },
      emitirCancelacion: async (runId) => {
        await inngestClient.send({ name: "workflow/corrida.cancelada", data: { runId } });
      },
      logger,
    },
    workflowSegmento: {
      runs: workflowRuns,
      workflows,
      registro: registroDeAcciones,
      logger,
    },
    workflowProgramados: { workflows, sessions, leads, logger },
    workflowInactividad: { workflows, sessions, conversations, messages, leads, logger },
    drenarDifusiones: { motor: motorDifusion, logger },
    copilotoBorrador: {
      borradores: new InMemoryBorradoresIaRepository(),
      conversations,
      sessions,
      messages,
      turnClassifications: new InMemoryTurnClassificationsRepository(),
      intentClassifier,
      aiAgent,
      configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
      logger,
    },
  };

  return {
    deps,
    metaClientSend,
    inngestSend,
    repos: { leads, conversations, sessions, messages, intents, rules, productos },
    logger,
  };
}
