import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { messageReceived } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import type { IntentClassification } from "@/lib/validation/ai";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { AiAgentService } from "@/server/services/ai-agent.service";
import type { IntentClassifierService } from "@/server/services/intent-classifier.service";
import type { MetaApiService } from "@/server/services/meta-api.service";
import type { Canal } from "@/types/domain";
import type { Lead, LeadSession, MetaUserIds, UUID } from "@/types/entities";

const RECENT_TURN_LIMIT = 10;

export type EmittedEvent =
  | {
      name: "lead-session/turn.completed";
      data: { leadSessionId: UUID; conversationTurn: string[] };
    }
  | {
      name: "lead-session/auto-handoff.evaluate";
      data: { leadSessionId: UUID; recentClassifications: IntentClassification[] };
    }
  | {
      name: "lead/created";
      data: { leadId: UUID; canal: Canal };
    };

export interface OnMessageReceivedDeps {
  leads: LeadsRepository;
  conversations: ConversationsRepository;
  sessions: LeadSessionRepository;
  messages: MessagesRepository;
  metaApi: MetaApiService;
  intentClassifier: IntentClassifierService;
  aiAgent: AiAgentService;
  emit: (event: EmittedEvent) => Promise<void>;
  logger?: Logger;
}

export interface OnMessageReceivedInput {
  parsed: ParsedMessage;
}

export interface OnMessageReceivedResult {
  leadId: UUID;
  leadCreated: boolean;
  sessionId: UUID;
  sessionCreated: boolean;
  conversacionId: UUID;
  agentSource: "rule" | "llm" | "handoff";
  sent: boolean;
  duplicate: boolean;
}

// Permite memoización granular por Inngest. En tests usar passthroughStep.
export interface StepRunner {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export const passthroughStep: StepRunner = {
  run: (_name, fn) => fn(),
};

export async function onMessageReceivedHandler(
  input: OnMessageReceivedInput,
  deps: OnMessageReceivedDeps,
  step: StepRunner = passthroughStep,
): Promise<OnMessageReceivedResult> {
  const { parsed } = input;
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "on-message-received",
    canal: parsed.canal,
    meta_message_id: parsed.meta_message_id,
  });

  logger.info("pipeline-start");

  try {
    const isDuplicate = await step.run("dedup", async () => {
      const existing = await deps.messages.findByMetaMessageId(parsed.meta_message_id);
      return existing !== null;
    });
    if (isDuplicate) logger.info("dedup-hit");

    const { lead, created: leadCreated } = await step.run("resolve-lead", () =>
      resolveLead(parsed, deps.leads),
    );
    if (leadCreated) {
      logger.info("lead-created", { lead_id: lead.id });
      await step.run("emit-lead-created", () =>
        deps.emit({
          name: "lead/created",
          data: { leadId: lead.id, canal: parsed.canal },
        }),
      );
    }

    const conv = await step.run("upsert-conv", () =>
      deps.conversations.upsertByCanalThread(parsed.canal, parsed.canal_thread_id, lead.id),
    );

    const { session, created: sessionCreated } = await step.run("resolve-session", () =>
      resolveActiveSession(lead.id, deps.sessions),
    );
    if (sessionCreated) logger.info("session-created", { session_id: session.id });

    await step.run("record-inbound", () =>
      deps.metaApi.recordInbound({
        conversacionId: conv.id,
        leadSessionId: session.id,
        parsed,
      }),
    );

    if (isDuplicate) {
      logger.info("pipeline-complete", { duplicate: true, sent: false });
      return {
        leadId: lead.id,
        leadCreated,
        sessionId: session.id,
        sessionCreated,
        conversacionId: conv.id,
        agentSource: "handoff",
        sent: false,
        duplicate: true,
      };
    }

    const classification = await step.run("classify", () =>
      deps.intentClassifier.classify(parsed.contenido ?? ""),
    );
    logger.info("classified", {
      intent: classification.intent_nombre,
      confidence: classification.confidence,
    });

    const conversationTurn = await step.run("build-turn", () =>
      buildConversationTurn(conv.id, deps.messages, session.context_summary),
    );

    const agentResult = await step.run("respond", () =>
      deps.aiAgent.respond({
        leadSessionId: session.id,
        conversationTurn,
        classification,
      }),
    );
    logger.info("agent-decision", {
      source: agentResult.source,
      respuesta_tipo: agentResult.respuesta_tipo,
      tool_calls_count: agentResult.tool_calls?.length ?? 0,
    });

    let sent = false;
    if (agentResult.source !== "handoff") {
      await step.run("send", () =>
        deps.metaApi.sendOutbound({
          conversacionId: conv.id,
          leadSessionId: session.id,
          canal: parsed.canal,
          to: parsed.meta_user_id,
          contenido: agentResult.respuesta_contenido,
          sender: "ia",
          idempotencyKey: `out:${parsed.meta_message_id}`,
        }),
      );
      sent = true;
      logger.info("send-out");
    } else {
      logger.info("send-skipped", { reason: "handoff" });
    }

    await step.run("emit-turn", () =>
      deps.emit({
        name: "lead-session/turn.completed",
        data: { leadSessionId: session.id, conversationTurn },
      }),
    );

    await step.run("emit-handoff-eval", () =>
      deps.emit({
        name: "lead-session/auto-handoff.evaluate",
        data: { leadSessionId: session.id, recentClassifications: [classification] },
      }),
    );

    logger.info("pipeline-complete", { duplicate: false, sent });

    return {
      leadId: lead.id,
      leadCreated,
      sessionId: session.id,
      sessionCreated,
      conversacionId: conv.id,
      agentSource: agentResult.source,
      sent,
      duplicate: false,
    };
  } catch (e) {
    logger.error("pipeline-error", {
      error_name: (e as Error).name,
      error_message: (e as Error).message,
    });
    throw e;
  }
}

async function resolveLead(
  parsed: ParsedMessage,
  leads: LeadsRepository,
): Promise<{ lead: Lead; created: boolean }> {
  if (parsed.canal === "wa") {
    const existing = await leads.findByTelefono(parsed.meta_user_id);
    if (existing) return { lead: existing, created: false };
    const created = await leads.create(buildPlaceholderLead(parsed));
    return { lead: created, created: true };
  }
  const existing = await leads.findByMetaUserId(parsed.canal, parsed.meta_user_id);
  if (existing) return { lead: existing, created: false };
  const created = await leads.create(buildPlaceholderLead(parsed));
  return { lead: created, created: true };
}

function buildPlaceholderLead(parsed: ParsedMessage): Parameters<LeadsRepository["create"]>[0] {
  const telefono =
    parsed.canal === "wa" ? parsed.meta_user_id : `${parsed.canal}:${parsed.meta_user_id}`;
  const meta_user_ids: MetaUserIds = {};
  meta_user_ids[canalKey(parsed.canal)] = parsed.meta_user_id;
  return {
    nombre: "",
    telefono,
    email: null,
    direccion: null,
    vehiculo_marca: "",
    vehiculo_modelo: "",
    vehiculo_anio: 0,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: parsed.canal,
    meta_user_ids,
  };
}

function canalKey(canal: Canal): keyof MetaUserIds {
  return canal;
}

async function resolveActiveSession(
  leadId: UUID,
  sessions: LeadSessionRepository,
): Promise<{ session: LeadSession; created: boolean }> {
  const existing = await sessions.findActiveByLeadId(leadId);
  if (existing) return { session: existing, created: false };
  const created = await sessions.create({
    lead_id: leadId,
    current_stage: "nuevo",
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
    ia_pausada: false,
  });
  return { session: created, created: true };
}

async function buildConversationTurn(
  conversacionId: UUID,
  messages: MessagesRepository,
  contextSummary: string | null,
): Promise<string[]> {
  const recent = await messages.listByConversacion(conversacionId, { limit: RECENT_TURN_LIMIT });
  const formatted = recent
    .slice()
    .reverse()
    .map((m) => `${m.sender}: ${m.contenido ?? ""}`);
  if (contextSummary) {
    return [`[Resumen previo]: ${contextSummary}`, ...formatted];
  }
  return formatted;
}

// Adapter: Inngest step.run devuelve Jsonify<T> (serializa Dates → string en replay).
// Para nuestro flujo objetos retornados se usan solo por ID (.id), no Date fields,
// así que cast es seguro. Si en futuro alguna stage retorna Date que se usa downstream,
// agregar conversión explícita o leer fresh desde repo dentro del step.
function adaptInngestStep(step: {
  run: <U>(name: string, fn: () => Promise<U>) => Promise<unknown>;
}): StepRunner {
  return {
    run: <T>(name: string, fn: () => Promise<T>): Promise<T> => step.run(name, fn) as Promise<T>,
  };
}

export function makeOnMessageReceivedFn(deps: OnMessageReceivedDeps) {
  return inngest.createFunction(
    {
      id: "on-message-received",
      // B4: serializar pipeline por meta_user_id evita races resolve-lead /
      // resolve-session cuando lead envía 2+ mensajes en paralelo. Sin esto
      // las UNIQUE constraints DB rescatan pero retries consumen LLM budget.
      // Pilot tier: latencia adicional negligible (lead humano no manda 2
      // mensajes en <100ms). Re-evaluar cap si peak > 100 msg/sec sostenido.
      concurrency: {
        key: "event.data.parsed.meta_user_id",
        limit: 1,
      },
      triggers: [{ event: messageReceived }],
    },
    async ({ event, step }) => {
      try {
        return await onMessageReceivedHandler(
          { parsed: event.data.parsed },
          deps,
          adaptInngestStep(step),
        );
      } catch (e) {
        if (isNonRetriable(e)) {
          throw new NonRetriableError((e as Error).message, { cause: e });
        }
        throw e;
      }
    },
  );
}
