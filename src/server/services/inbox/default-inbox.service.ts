import { NotFoundError } from "@/lib/errors";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { Canal } from "@/types/domain";
import type { Conversacion, Mensaje, UUID } from "@/types/entities";
import type { ConversationView, InboxItem, InboxService } from "./inbox.service";

// Cap thread: sesiones cortas (5-15 msgs); 200 cubre outliers sin paginar.
const CONVERSATION_MESSAGES_LIMIT = 200;

export interface DefaultInboxServiceDeps {
  leads: LeadsRepository;
  sessions: LeadSessionRepository;
  convs: ConversationsRepository;
  messages: MessagesRepository;
}

export class DefaultInboxService implements InboxService {
  constructor(private readonly deps: DefaultInboxServiceDeps) {}

  async listActiveLeads(): Promise<InboxItem[]> {
    const activeSessions = await this.deps.sessions.listActive();

    const items: InboxItem[] = [];
    for (const session of activeSessions) {
      const lead = await this.deps.leads.findById(session.lead_id);
      if (!lead) continue;

      const convs = await this.deps.convs.findByLeadId(session.lead_id);
      const canales: Canal[] = Array.from(new Set(convs.map((c) => c.canal)));

      let lastMsg: Mensaje | null = null;
      for (const conv of convs) {
        const msgs = await this.deps.messages.listByConversacion(conv.id, { limit: 1 });
        const candidate = msgs[0];
        if (!candidate) continue;
        if (!lastMsg || candidate.created_at.getTime() > lastMsg.created_at.getTime()) {
          lastMsg = candidate;
        }
      }

      const ultimaActividad =
        lastMsg?.created_at ?? convs[0]?.ultima_actividad_at ?? session.started_at;

      items.push({
        leadId: lead.id,
        sessionId: session.id,
        nombre: lead.nombre,
        currentStage: session.current_stage,
        iaPausada: session.ia_pausada,
        ultimaActividad,
        ultimoMensaje: lastMsg
          ? {
              body: lastMsg.contenido ?? "",
              direction: lastMsg.direction,
              createdAt: lastMsg.created_at,
            }
          : null,
        canales,
      });
    }

    items.sort((a, b) => b.ultimaActividad.getTime() - a.ultimaActividad.getTime());
    return items;
  }

  async getConversation(leadId: UUID): Promise<ConversationView> {
    const lead = await this.deps.leads.findById(leadId);
    if (!lead) {
      throw new NotFoundError(`lead no encontrado: ${leadId}`, "lead", leadId);
    }

    const session = await this.deps.sessions.findActiveByLeadId(leadId);
    const convs = await this.deps.convs.findByLeadId(leadId);
    const canales: Canal[] = Array.from(new Set(convs.map((c) => c.canal)));

    let masReciente: Conversacion | null = null;
    for (const conv of convs) {
      if (
        !masReciente ||
        conv.ultima_actividad_at.getTime() > masReciente.ultima_actividad_at.getTime()
      ) {
        masReciente = conv;
      }
    }
    const canalActivo: Canal = masReciente?.canal ?? lead.canal_origen;

    const messages = session
      ? await this.deps.messages.listBySessionId(session.id, {
          limit: CONVERSATION_MESSAGES_LIMIT,
        })
      : [];

    return { lead, session, messages, canales, canalActivo };
  }
}
