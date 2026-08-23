/**
 * Bootstrap Inngest deps — Slice 1 sub-paso 7.8.
 *
 * Construye `CrmInngestDeps` (consumido por `makeCrmInngestFunctions`) wireando
 * todas las dependencias reales en orden topológico:
 *
 *   env → DbClient (service-role) → Repositories Supabase → Services Default
 *        → LlmBundle (factory 7.7.A real|mock) → Callbacks → Deps record
 *
 * Punto único de wireup. Consumido por `/api/webhooks/inngest` route + futuros
 * smoke tests E2E.
 *
 * Reglas zone (ESLint boundaries): inngest puede importar de server-services +
 * server-repositories + server-db + server-lock + lib + types. Este file vive
 * en `src/inngest/` por eso.
 */

import { GraphApiMetaClient } from "@/server/services/meta/graph-api-client";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultLeadMergeDetectorService } from "@/server/services/lead-merge-detector.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DefaultTwinExtractorService } from "@/server/services/twin-extractor.service";

import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseEventOutboxRepository } from "@/server/repositories/event-outbox.supabase.repo";
import { SupabaseHandoffEventsRepository } from "@/server/repositories/handoff-events.supabase.repo";
import { SupabaseIntentsRepository } from "@/server/repositories/intents.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.supabase.repo";
import { SupabaseLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.supabase.repo";
import { SupabaseReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { SupabaseMergeCandidatesRepository } from "@/server/repositories/merge-candidates.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseProductsRepository } from "@/server/repositories/productos.supabase.repo";
import { SupabaseReactivationDispatchesRepository } from "@/server/repositories/reactivation-dispatches.supabase.repo";
import { SupabaseRuleExecutionsRepository } from "@/server/repositories/rule-executions.supabase.repo";
import { SupabaseSessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.supabase.repo";
import { SupabaseRulesRepository } from "@/server/repositories/rules.supabase.repo";
import { SupabaseToolExecutionsRepository } from "@/server/repositories/tool-executions.supabase.repo";
import { SupabaseTurnClassificationsRepository } from "@/server/repositories/turn-classifications.supabase.repo";
import { SupabaseAgenteConfigRepository } from "@/server/repositories/agente-config.supabase.repo";
import { SupabaseLlmUsageRepository } from "@/server/repositories/llm-usage.supabase.repo";
import { SupabaseWorkflowsRepository } from "@/server/repositories/workflows.supabase.repo";
import { SupabaseWorkflowRunsRepository } from "@/server/repositories/workflow-runs.supabase.repo";

import { makeCostTracker } from "@/lib/observability/upstash-cost-tracker";
import { PersistingCostTracker } from "@/server/services/llm/persisting-cost-tracker";
import { getLogger } from "@/lib/observability/get-logger";
import type { Logger } from "@/lib/observability/logger";
import { makeLlmFactory, type LlmBundle } from "@/server/services/llm/llm-factory";
import { OPENAI_PRICING } from "@/server/services/llm/pricing";
import { CachedAgentConfigProvider } from "@/server/services/agente/config-provider";

import type { AppEnv } from "@/lib/env";
import type { AppClient } from "@/server/db/client";
import type { CrmInngestClient } from "@/inngest/client";
import type { CrmInngestDeps } from "@/inngest/functions";

import { makeEmitForOnMessageReceived, makeInngestEmitForOutbox } from "@/inngest/callbacks/emit";
import { recordatorioCancelado, workflowSegmentoPendiente } from "@/inngest/events";
import { makePurgeSession } from "@/inngest/callbacks/purge-session";
import { makeSendReactivation } from "@/inngest/callbacks/send-reactivation";
import { makeConversationsParaEnviarMensaje } from "@/inngest/callbacks/workflow-adapters";

import { crearAccionesInternas } from "@/server/services/workflows/acciones/internas";
import { crearAccionEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import type { ConfigProviderParaEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";

export interface BootstrapConfig {
  env: AppEnv;
  db: AppClient;
  inngest: CrmInngestClient;
  logger?: Logger;
}

export interface BootstrapResult {
  deps: CrmInngestDeps;
  llmBundle: LlmBundle;
  logger: Logger;
}

/**
 * Wireup completo. Llamado UNA vez por proceso (Vercel function instance).
 *
 * No es singleton — caller decide ciclo. Tests pueden invocar múltiples veces
 * con mocks distintos.
 */
export function makeInngestDeps(cfg: BootstrapConfig): BootstrapResult {
  const logger = cfg.logger ?? getLogger({ scope: "inngest" });
  const { env, db, inngest } = cfg;

  // ===== Repositories (single instance, share Supabase client) =====
  const leads = new SupabaseLeadsRepository(db);
  const conversations = new SupabaseConversationsRepository(db);
  const sessions = new SupabaseLeadSessionRepository(db);
  const messages = new SupabaseMessagesRepository(db);
  const intents = new SupabaseIntentsRepository(db);
  const rules = new SupabaseRulesRepository(db);
  const ruleExecutions = new SupabaseRuleExecutionsRepository(db);
  const turnClassifications = new SupabaseTurnClassificationsRepository(db);
  const productos = new SupabaseProductsRepository(db);
  const reactivationDispatches = new SupabaseReactivationDispatchesRepository(db);
  const mergeCandidates = new SupabaseMergeCandidatesRepository(db);
  const identificadores = new SupabaseLeadIdentificadoresRepository(db);
  const vehiculos = new SupabaseLeadVehiculosRepository(db);
  const reglasEtiqueta = new SupabaseReglasEtiquetaRepository(db);
  const tags = new SupabaseTagsRepository(db);
  const eventOutbox = new SupabaseEventOutboxRepository(db);
  const toolExecutions = new SupabaseToolExecutionsRepository(db);
  const recordatorios = new SupabaseSessionRecordatoriosRepository(db);
  const handoffEvents = new SupabaseHandoffEventsRepository(db, sessions);
  const workflows = new SupabaseWorkflowsRepository(db);
  const workflowRuns = new SupabaseWorkflowRunsRepository(db);

  // ===== Infrastructure (cost tracker, LLM bundle) =====
  // Dos responsabilidades distintas, deliberadamente separadas:
  //   - el contador de adentro resuelve el total del día y el kill switch;
  //   - el decorador deja una fila por llamada en `llm_usage`, que es lo único
  //     con lo que se puede responder cuánto costó una conversación o un lead.
  // El segundo no reemplaza al primero: un total diario no se desagrega, y una
  // suma de filas no sirve para cortar a mitad de turno.
  const costTracker = new PersistingCostTracker({
    inner: makeCostTracker({
      pricing: OPENAI_PRICING,
      dailyCapUsd: env.LLM_DAILY_CAP_USD,
      upstashUrl: env.UPSTASH_REDIS_REST_URL,
      upstashToken: env.UPSTASH_REDIS_REST_TOKEN,
      logger,
    }),
    repo: new SupabaseLlmUsageRepository(db),
    pricing: OPENAI_PRICING,
    logger,
  });

  // El agente lee su config de la DB en cada turno; los otros 4 LLM siguen por env.
  const agenteConfigProvider = new CachedAgentConfigProvider(
    new SupabaseAgenteConfigRepository(db),
    logger,
  );

  const llmBundle = makeLlmFactory({
    mode: env.LLM_MODE,
    openaiApiKey: env.OPENAI_API_KEY,
    modelName: env.OPENAI_MODEL,
    models: {
      intentClassifier: env.OPENAI_MODEL_CLASSIFIER,
      twinExtractor: env.OPENAI_MODEL_TWIN,
      conversationSummarizer: env.OPENAI_MODEL_SUMMARIZER,
      intentBatchDetector: env.OPENAI_MODEL_BATCH,
    },
    configProvider: agenteConfigProvider,
    costTracker,
  });

  // ===== Meta client (Graph API real) =====
  const metaClient = new GraphApiMetaClient({
    graphApiVersion: env.META_GRAPH_API_VERSION,
    whatsappPhoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID,
    whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
    igPageId: env.META_IG_PAGE_ID,
    igAccessToken: env.META_IG_ACCESS_TOKEN,
    fbPageId: env.META_FB_PAGE_ID,
    fbAccessToken: env.META_FB_PAGE_ACCESS_TOKEN,
  });

  // ===== Services Default impls (DI repos + LLMs) =====
  const catalog = new DefaultCatalogMatcherService(productos);
  const ruleEngine = new DefaultRuleEngineService(intents, rules, reglasEtiqueta);
  const intentClassifier = new DefaultIntentClassifierService(intents, llmBundle.intentClassifier);
  const twinExtractor = new DefaultTwinExtractorService(
    sessions,
    llmBundle.twinExtractor,
    vehiculos,
  );
  // Con el provider, el umbral de escalado sale de la config activa en vez
  // del valor de fábrica: es el mismo cache de 30s que usa el resto del turno.
  const handoff = new DefaultHandoffService(sessions, agenteConfigProvider, handoffEvents);
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
    undefined, // flags (default AllEnabled)
    toolExecutions,
    handoff,
  );

  // ===== Motor de workflows (W2/Task 10) =====
  // `configProvider.get()` con otro nombre: ver el doc comment de
  // `ConfigProviderParaEnviarMensaje` en `acciones/enviar-mensaje.ts` sobre
  // por qué esto es un adaptador de una línea y no el provider real.
  const configProviderParaEnviarMensaje: ConfigProviderParaEnviarMensaje = {
    activa: () => agenteConfigProvider.get(),
  };
  const registroDeAcciones = crearRegistro({
    ...crearAccionesInternas({ tags, sessions, handoff }),
    enviar_mensaje: crearAccionEnviarMensaje({
      messages,
      metaApi,
      conversations: makeConversationsParaEnviarMensaje({ conversations, messages }),
      leads,
      configProvider: configProviderParaEnviarMensaje,
    }),
  });

  // ===== Callbacks =====
  const emit = makeEmitForOnMessageReceived(inngest);
  const inngestEmit = makeInngestEmitForOutbox(inngest);
  const purgeSession = makePurgeSession({
    sessions,
    messages,
    removeMedia: async (paths) => {
      const { error } = await db.storage.from("mensajes_media").remove(paths);
      if (error) throw new Error(error.message);
    },
    logger: logger.child({ scope: "purge-session" }),
  });
  const sendReactivation = makeSendReactivation({
    leads,
    sessions,
    convs: conversations,
    metaApi,
    logger: logger.child({ scope: "send-reactivation" }),
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
      handoff,
      // Misma instancia usada por el LlmBundle: un solo cache de 30s sirve a
      // todo el pipeline en vez de duplicar lecturas a la DB.
      configProvider: agenteConfigProvider,
      ruleExecutions,
      turnClassifications,
      // Mismo motor que elige la respuesta enlatada: acá se le pide el otro
      // método, el que dice qué etiquetas corresponden al turno.
      ruleEngine,
      tags,
      intents,
      // Misma instancia que usa el detector de duplicados: el lead que nace del
      // webhook tiene que dejar su teléfono acá o el detector no lo ve.
      identificadores,
      // Apaga el seguimiento apenas el cliente vuelve a escribir.
      recordatorios,
      cancelarAvisoRecordatorio: async (input) => {
        await inngest.send({
          name: recordatorioCancelado.name,
          data: {
            recordatorioId: input.recordatorioId,
            recordarAt: input.recordarAt.toISOString(),
          },
          id: `recordatorio-cancelado:${input.recordatorioId}:${input.recordarAt.toISOString()}`,
        });
      },
      emit,
      logger,
    },
    onStatusReceived: {
      messages,
    },
    updateLeadTwin: {
      twinExtractor,
    },
    detectIntentsBatch: {
      sessions,
      conversations,
      messages,
      intents,
      detector: llmBundle.intentBatchDetector,
    },
    autoHandoff: {
      handoff,
    },
    purgeOldSessions: {
      sessions,
      purgeSession,
    },
    reactivationPredictor: {
      sessions,
      dispatches: reactivationDispatches,
      sendReactivation,
    },
    recordatorioSeguimiento: {
      recordatorios,
      // `avisarAlCliente` NO se wirea a propósito: el recordatorio avisa al
      // vendedor y no le manda nada al cliente. Ver el comentario largo en
      // `recordatorio-seguimiento.ts`.
      logger,
    },
    handoffNotification: {
      sessions,
      conversations,
      configProvider: agenteConfigProvider,
      metaApi,
      logger,
    },
    detectMergeCandidatesPerLead: {
      detector: mergeDetector,
      logger,
    },
    detectMergeCandidatesGlobal: {
      leads,
      detector: mergeDetector,
      logger,
    },
    dispatchOutboxEvents: {
      outbox: eventOutbox,
      inngestEmit,
      logger,
    },
    workflowDisparar: {
      workflows,
      runs: workflowRuns,
      emitir: async ({ runId, desdePaso }) => {
        await inngest.send({
          name: workflowSegmentoPendiente.name,
          data: { runId, desdePaso },
          id: `workflow-segmento-pendiente:${runId}:${desdePaso}`,
        });
      },
      logger,
    },
    workflowSegmento: {
      runs: workflowRuns,
      workflows,
      registro: registroDeAcciones,
      logger,
    },
  };

  return { deps, llmBundle, logger };
}
