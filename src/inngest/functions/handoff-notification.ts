import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { handoffNotificationRequested } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import type { MetaApiService } from "@/server/services/meta-api.service";
import type { Conversacion, UUID } from "@/types/entities";

export interface HandoffNotificationDeps {
  sessions: LeadSessionRepository;
  conversations: ConversationsRepository;
  configProvider: AgentConfigProvider;
  metaApi: MetaApiService;
  logger?: Logger;
}

export interface HandoffNotificationInput {
  handoffEventId: UUID;
  leadSessionId: UUID;
}

export interface HandoffNotificationResult {
  sent: boolean;
  reason?: "session_missing" | "session_resumed" | "conversation_missing";
}

function latest(conversations: Conversacion[]): Conversacion | null {
  return conversations.reduce<Conversacion | null>(
    (selected, item) =>
      selected === null || item.ultima_actividad_at > selected.ultima_actividad_at
        ? item
        : selected,
    null,
  );
}

export async function handoffNotificationHandler(
  input: HandoffNotificationInput,
  deps: HandoffNotificationDeps,
): Promise<HandoffNotificationResult> {
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "handoff-notification",
    handoff_event_id: input.handoffEventId,
  });
  const session = await deps.sessions.findById(input.leadSessionId);
  if (!session) return { sent: false, reason: "session_missing" };
  if (!session.ia_pausada) return { sent: false, reason: "session_resumed" };

  const conversation = latest(await deps.conversations.findByLeadId(session.lead_id));
  if (!conversation) return { sent: false, reason: "conversation_missing" };
  const config = await deps.configProvider.get();
  await deps.metaApi.sendOutbound({
    conversacionId: conversation.id,
    leadSessionId: session.id,
    canal: conversation.canal,
    to: conversation.canal_thread_id,
    contenido: config.plantilla_escalado,
    sender: "sistema",
    idempotencyKey: `handoff-notice:${input.handoffEventId}`,
    plantilla: "handoff",
  });
  logger.info("handoff-notification-sent", { canal: conversation.canal });
  return { sent: true };
}

export function makeHandoffNotificationFn(deps: HandoffNotificationDeps) {
  return inngest.createFunction(
    {
      id: "handoff-notification",
      triggers: [{ event: handoffNotificationRequested }],
    },
    async ({ event, step }) => {
      const day = new Date(event.ts).toISOString().slice(0, 10);
      return step.run(`handoff-notice-${day}-${event.data.handoffEventId}`, async () => {
        try {
          return await handoffNotificationHandler(event.data, deps);
        } catch (error) {
          if (isNonRetriable(error)) {
            throw new NonRetriableError((error as Error).message, { cause: error });
          }
          throw error;
        }
      });
    },
  );
}
