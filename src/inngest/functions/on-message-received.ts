import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { messageReceived } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { excedeDescuento } from "@/lib/agente/descuento";
import { estaAbierto } from "@/lib/agente/horario";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import { claveSaliente } from "@/server/services/meta-api.service";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import type { IntentClassification } from "@/lib/validation/ai";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { IntentsRepository } from "@/server/repositories/intents.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { RuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import {
  NoopSessionRecordatoriosRepository,
  type SessionRecordatoriosRepository,
} from "@/server/repositories/session-recordatorios.repo";
import type { TurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import type { AiAgentService } from "@/server/services/ai-agent.service";
import type { IntentClassifierService } from "@/server/services/intent-classifier.service";
import type { MetaApiService } from "@/server/services/meta-api.service";
import type { Canal } from "@/types/domain";
import type { Lead, LeadSession, MetaUserIds, UUID } from "@/types/entities";

export type EmittedEvent =
  | {
      name: "lead-session/turn.completed";
      data: { leadSessionId: UUID; conversationTurn: string[]; mensajeOrigenId?: UUID };
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
  ruleExecutions: RuleExecutionsRepository;
  turnClassifications: TurnClassificationsRepository;
  /** Solo para resolver el intent clasificado a su id al auditar el turno. */
  intents: IntentsRepository;
  /**
   * Para apagar el seguimiento cuando el cliente vuelve solo. Opcional con
   * default Noop —mismo criterio que `dispatches` en el cron de reactivación—
   * para que los callers viejos sigan compilando; `bootstrap.ts` lo wirea.
   */
  recordatorios?: SessionRecordatoriosRepository;
  configProvider: AgentConfigProvider;
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

    const inbound = await step.run("record-inbound", () =>
      deps.metaApi.recordInbound({
        conversacionId: conv.id,
        leadSessionId: session.id,
        parsed,
      }),
    );

    // El cliente escribió: el seguimiento que alguien se puso sobre esta
    // conversación deja de tener sentido. Un recordatorio es "se quedó
    // callado", y este mensaje es la prueba de que no.
    //
    // Va acá arriba, pegado al entrante y antes de todas las salidas tempranas
    // —duplicado, fuera de horario, descuento excedido—: un mensaje del cliente
    // a las 3 de la mañana cancela igual, aunque el agente no lo conteste
    // hasta que abra. Cancelar de más no rompe nada; no cancelar deja al
    // vendedor persiguiendo a alguien que ya respondió.
    const recordatorios = deps.recordatorios ?? new NoopSessionRecordatoriosRepository();
    const cancelados = await step.run("cancelar-recordatorios", () =>
      recordatorios.cancelarVivosDeSesion(session.id, "respondio"),
    );
    // Solo la cuenta: la nota del recordatorio puede tener datos del cliente.
    if (cancelados > 0) logger.info("recordatorios-cancelados", { cantidad: cancelados });

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

    const config = await deps.configProvider.get();

    // Fuera de horario: no se invoca ningun LLM (ni classifier ni agente).
    // Con plantilla configurada se responde eso; sin ella, no se responde
    // nada y la sesion queda como esta para que el triage humano la retome.
    if (!estaAbierto(config.horario, config.horario_timezone, new Date())) {
      let templateSent = false;
      if (config.plantilla_fuera_horario !== "") {
        await step.run("send", () =>
          deps.metaApi.sendOutbound({
            conversacionId: conv.id,
            leadSessionId: session.id,
            canal: parsed.canal,
            to: parsed.meta_user_id,
            contenido: config.plantilla_fuera_horario,
            sender: "ia",
            idempotencyKey: claveSaliente(parsed.meta_message_id),
            // Este camino corta antes del clasificador y de las reglas, así que
            // no deja fila en ninguna de las cuatro tablas de auditoría. Sin la
            // marca, el saliente es indistinguible de un turno que nadie midió
            // y la auditoría tiene que decir que no sabe — cuando sí se sabe.
            plantilla: "fuera_horario",
          }),
        );
        templateSent = true;
      }
      logger.info("pipeline-complete", {
        duplicate: false,
        sent: templateSent,
        skipped: "fuera_de_horario",
      });
      return {
        leadId: lead.id,
        leadCreated,
        sessionId: session.id,
        sessionCreated,
        conversacionId: conv.id,
        agentSource: "handoff",
        sent: templateSent,
        duplicate: false,
      };
    }

    // El entrante viaja junto al texto: no cambia la clasificación, pero es lo
    // que hace que el gasto del clasificador quede atribuido a esta sesión en
    // vez de aparecer como costo sin dueño en el reporte por lead.
    const classification = await step.run("classify", () =>
      deps.intentClassifier.classify(parsed.contenido ?? "", {
        mensajeId: inbound.id,
        leadSessionId: session.id,
      }),
    );
    logger.info("classified", {
      intent: classification.intent_nombre,
      confidence: classification.confidence,
    });

    const conversationTurn = await step.run("build-turn", () =>
      buildConversationTurn(
        conv.id,
        deps.messages,
        session.context_summary,
        config.ventana_contexto_mensajes,
      ),
    );

    const agentResult = await step.run("respond", () =>
      deps.aiAgent.respond({
        leadSessionId: session.id,
        conversationTurn,
        classification,
        mensajeOrigenId: inbound.id,
      }),
    );
    logger.info("agent-decision", {
      source: agentResult.source,
      respuesta_tipo: agentResult.respuesta_tipo,
      tool_calls_count: agentResult.tool_calls?.length ?? 0,
    });

    // Turno resuelto por el LLM: ninguna regla lo cubrió. Sin esta fila la
    // clasificación se pierde y `rule_executions` termina registrando, por
    // construcción, solo los intents que YA tienen regla — justo los que no
    // hace falta descubrir. Se audita contra el mensaje ENTRANTE, igual que la
    // auditoría de reglas, y antes de la guarda de descuento: el modelo ya
    // corrió y ya se pagó, aunque después la respuesta se descarte.
    if (agentResult.source === "llm") {
      await step.run("auditar-clasificacion", async () => {
        // El clasificador ya validó el nombre contra los intents activos, así
        // que un nombre no nulo resuelve; nulo = no reconoció ninguno.
        const intent =
          classification.intent_nombre !== null
            ? await deps.intents.findByNombre(classification.intent_nombre)
            : null;
        await deps.turnClassifications.create({
          mensaje_id: inbound.id,
          intent_id: intent?.id ?? null,
          intent_nombre: classification.intent_nombre,
          confidence: classification.confidence,
        });
      });
    }

    let sent = false;
    if (agentResult.source !== "handoff") {
      const descuentoOfrecido = excedeDescuento(
        agentResult.respuesta_contenido,
        config.descuento_max_pct,
      );
      if (descuentoOfrecido !== null) {
        // Se descarta la respuesta: no llega al cliente. La sesion pasa a
        // triage humano con la IA pausada hasta que alguien la revise.
        logger.warn("agente.descuento_excedido", {
          ofrecido: descuentoOfrecido,
          maximo: config.descuento_max_pct,
          sessionId: session.id,
        });
        await step.run("pausar-por-descuento", () =>
          deps.sessions.update(session.id, {
            current_stage: "requiere_humano",
            ia_pausada: true,
          }),
        );
        logger.info("pipeline-complete", {
          duplicate: false,
          sent: false,
          skipped: "descuento_excedido",
        });
        return {
          leadId: lead.id,
          leadCreated,
          sessionId: session.id,
          sessionCreated,
          conversacionId: conv.id,
          agentSource: "handoff",
          sent: false,
          duplicate: false,
        };
      }

      await step.run("send", () =>
        deps.metaApi.sendOutbound({
          conversacionId: conv.id,
          leadSessionId: session.id,
          canal: parsed.canal,
          to: parsed.meta_user_id,
          contenido: agentResult.respuesta_contenido,
          sender: "ia",
          idempotencyKey: claveSaliente(parsed.meta_message_id),
        }),
      );
      sent = true;
      logger.info("send-out");

      // La tabla `rule_executions` existe desde Slice 1 y nunca se escribio:
      // el agente devolvia `regla_id` y nadie lo guardaba, asi que no habia
      // forma de responder "por que el cliente recibio esta respuesta".
      // Se audita contra el mensaje ENTRANTE, que es el que disparo la regla.
      if (agentResult.source === "rule" && agentResult.regla_id && agentResult.intent_id) {
        await step.run("auditar-regla", () =>
          deps.ruleExecutions.create({
            regla_id: agentResult.regla_id as UUID,
            mensaje_id: inbound.id,
            matched_intent_id: agentResult.intent_id as UUID,
          }),
        );
      }
    } else {
      logger.info("send-skipped", { reason: "handoff" });
    }

    await step.run("emit-turn", () =>
      deps.emit({
        name: "lead-session/turn.completed",
        data: {
          leadSessionId: session.id,
          conversationTurn,
          // El entrante que disparó el turno. Sin esto la procedencia que
          // escribe el extractor queda con `mensaje_origen_id: null` y el Twin
          // no puede decir de qué mensaje ni de qué hora salió cada dato.
          mensajeOrigenId: inbound.id,
        },
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
  const existing =
    parsed.canal === "wa"
      ? await leads.findByTelefono(parsed.meta_user_id)
      : await leads.findByMetaUserId(parsed.canal, parsed.meta_user_id);

  if (existing)
    return { lead: await sincronizarNombrePerfil(existing, parsed, leads), created: false };

  const created = await leads.create(buildPlaceholderLead(parsed));
  return { lead: created, created: true };
}

/**
 * Mantiene `nombre_perfil` al día con lo que dice Meta.
 *
 * El dato es de la plataforma, no nuestro: si el cliente se cambia el nombre en
 * WhatsApp, el nuestro tiene que seguirlo. `leads.nombre` no se toca nunca acá
 * —ese lo escribe el vendedor y un alias de redes no lo pisa—. Sin cambio no
 * hay UPDATE: escribir en cada mensaje entrante movería `updated_at` de todos
 * los leads y desordenaría la lista, que ordena por esa columna.
 */
async function sincronizarNombrePerfil(
  lead: Lead,
  parsed: ParsedMessage,
  leads: LeadsRepository,
): Promise<Lead> {
  const nuevo = parsed.nombre_perfil;
  // `null` es "este canal no lo manda", no "se lo borraron": no pisa lo guardado.
  if (nuevo === null || nuevo === lead.nombre_perfil) return lead;
  return leads.update(lead.id, { nombre_perfil: nuevo });
}

function buildPlaceholderLead(parsed: ParsedMessage): Parameters<LeadsRepository["create"]>[0] {
  const telefono =
    parsed.canal === "wa" ? parsed.meta_user_id : `${parsed.canal}:${parsed.meta_user_id}`;
  const meta_user_ids: MetaUserIds = {};
  meta_user_ids[canalKey(parsed.canal)] = parsed.meta_user_id;
  return {
    // `nombre` sigue naciendo vacío a propósito: es el nombre que le pone la
    // casa. El de Meta va aparte y no compite con él.
    nombre: "",
    nombre_perfil: parsed.nombre_perfil,
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
  limit: number,
): Promise<string[]> {
  const recent = await messages.listByConversacion(conversacionId, { limit });
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
