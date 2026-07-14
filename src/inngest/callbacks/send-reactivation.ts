import { ValidationError } from "@/lib/errors";
import type { Logger } from "@/lib/observability/logger";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MetaApiService } from "@/server/services/meta-api.service";
import type {
  ReactivationSendInput,
  ReactivationSendResult,
} from "@/inngest/functions/reactivation-predictor.cron";
import type { MotivoPerdida } from "@/types/domain";
import type { Conversacion } from "@/types/entities";

/**
 * Reactivación real (Slice 4a 10.7). El cron enforce cooldown y persiste el
 * dispatch con el status retornado:
 *   - "sent"    → mensaje salió por Meta.
 *   - "bounced" → skip deliberado (sesión activa, sin conversación, canal sin
 *     config, lead borrado). Registrarlo activa el cooldown = no reintenta
 *     cada corrida contra el mismo lead imposible.
 *   - throw     → error retriable (Meta 5xx, red): Inngest reintenta el step
 *     y el dispatch no se persiste.
 *
 * Idempotency: key determinística `react-<sessionId>` — retry del step tras
 * send exitoso no duplica el mensaje (dedup en MetaApiService).
 */

export interface SendReactivationDeps {
  leads: LeadsRepository;
  sessions: LeadSessionRepository;
  convs: ConversationsRepository;
  metaApi: MetaApiService;
  logger: Logger;
}

type TemplateBuilder = (nombre: string) => string;

const TEMPLATES: Record<MotivoPerdida | "default", { name: string; build: TemplateBuilder }> = {
  precio: {
    name: "reactivacion_precio_v1",
    build: (n) =>
      `Hola ${n}! Te escribimos porque tenemos nuevas opciones de precio en el repuesto que consultaste. ¿Querés que te pasemos la cotización actualizada?`,
  },
  stock: {
    name: "reactivacion_stock_v1",
    build: (n) =>
      `Hola ${n}! Buenas noticias: nos volvió a entrar stock del repuesto que buscabas. ¿Seguís interesado?`,
  },
  tiempo: {
    name: "reactivacion_tiempo_v1",
    build: (n) =>
      `Hola ${n}! Ahora tenemos mejores tiempos de entrega para el repuesto que consultaste. ¿Te pasamos las opciones?`,
  },
  no_responde: {
    name: "reactivacion_no_responde_v1",
    build: (n) =>
      `Hola ${n}! Quedó pendiente tu consulta de repuestos. Si todavía lo necesitás, respondé este mensaje y lo retomamos.`,
  },
  otro: {
    name: "reactivacion_otro_v1",
    build: (n) =>
      `Hola ${n}! Hace un tiempo consultaste por un repuesto. Si seguís buscándolo, avisanos y te ayudamos.`,
  },
  default: {
    name: "reactivacion_generica_v1",
    build: (n) =>
      `Hola ${n}! Te escribimos de la casa de repuestos. ¿Pudiste resolver lo que estabas buscando? Seguimos a disposición.`,
  },
};

function pickLatestConversation(convs: Conversacion[]): Conversacion | null {
  let latest: Conversacion | null = null;
  for (const c of convs) {
    if (!latest || c.ultima_actividad_at.getTime() > latest.ultima_actividad_at.getTime()) {
      latest = c;
    }
  }
  return latest;
}

export function makeSendReactivation(
  deps: SendReactivationDeps,
): (input: ReactivationSendInput) => Promise<ReactivationSendResult> {
  return async (input) => {
    const lead = await deps.leads.findById(input.leadId);
    if (!lead) {
      deps.logger.warn("sendReactivation.skip.lead_inexistente", { leadId: input.leadId });
      return { status: "bounced", templateName: "skip_lead_inexistente", metaMessageId: null };
    }

    // Sesión activa = conversación viva; reactivar sería spam.
    const active = await deps.sessions.findActiveByLeadId(input.leadId);
    if (active) {
      deps.logger.info("sendReactivation.skip.sesion_activa", {
        leadId: input.leadId,
        activeSessionId: active.id,
      });
      return { status: "bounced", templateName: "skip_sesion_activa", metaMessageId: null };
    }

    const conv = pickLatestConversation(await deps.convs.findByLeadId(input.leadId));
    if (!conv) {
      deps.logger.warn("sendReactivation.skip.sin_conversacion", { leadId: input.leadId });
      return { status: "bounced", templateName: "skip_sin_conversacion", metaMessageId: null };
    }

    const template = TEMPLATES[input.motivo ?? "default"];
    const contenido = template.build(lead.nombre.split(" ")[0] ?? lead.nombre);

    try {
      const msg = await deps.metaApi.sendOutbound({
        conversacionId: conv.id,
        leadSessionId: input.sessionId,
        canal: conv.canal,
        to: conv.canal_thread_id,
        contenido,
        sender: "ia",
        idempotencyKey: `react-${input.sessionId}`,
      });
      deps.logger.info("sendReactivation.sent", {
        leadId: input.leadId,
        sessionId: input.sessionId,
        canal: conv.canal,
        template: template.name,
      });
      return {
        status: "sent",
        templateName: template.name,
        metaMessageId: msg.meta_message_id,
      };
    } catch (e) {
      if (e instanceof ValidationError) {
        // Canal sin config (envHint) — no retriable, registrar y enfriar.
        deps.logger.warn("sendReactivation.skip.canal_sin_config", {
          leadId: input.leadId,
          canal: conv.canal,
        });
        return { status: "bounced", templateName: "skip_canal_sin_config", metaMessageId: null };
      }
      throw e;
    }
  };
}
