import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { detectIntentsBatchRequested } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { IntentsRepository } from "@/server/repositories/intents.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { LeadSession, UUID } from "@/types/entities";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface DetectedIntent {
  nombre: string;
  descripcion: string;
  ejemplos: string[];
}

export interface BatchSessionInput {
  sessionId: UUID;
  leadId: UUID;
  messages: string[];
}

export interface IntentBatchDetectorInput {
  sessions: BatchSessionInput[];
}

export interface IntentBatchDetectorLLM {
  detect(input: IntentBatchDetectorInput): Promise<DetectedIntent[]>;
}

export interface DetectIntentsBatchDeps {
  sessions: LeadSessionRepository;
  conversations: ConversationsRepository;
  messages: MessagesRepository;
  intents: IntentsRepository;
  detector: IntentBatchDetectorLLM;
  now?: () => Date;
}

export interface DetectIntentsBatchResult {
  scanned: number;
  detected: number;
  persisted: number;
}

export async function detectIntentsBatchHandler(
  _input: Record<string, never>,
  deps: DetectIntentsBatchDeps,
): Promise<DetectIntentsBatchResult> {
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - SEVEN_DAYS_MS);

  const allClosed = await deps.sessions.listClosedBefore(now);
  const recent = allClosed.filter((s) => s.closed_at !== null && s.closed_at >= cutoff);

  const batch: BatchSessionInput[] = [];
  for (const s of recent) {
    const messages = await collectSessionMessages(s, deps);
    batch.push({ sessionId: s.id, leadId: s.lead_id, messages });
  }

  const detected = await deps.detector.detect({ sessions: batch });

  let persisted = 0;
  for (const proposal of detected) {
    const exists = await deps.intents.findByNombre(proposal.nombre);
    if (exists) continue;
    await deps.intents.create({
      nombre: proposal.nombre,
      descripcion: proposal.descripcion,
      ejemplos: proposal.ejemplos,
      auto_detectado: true,
      activo: false,
    });
    persisted += 1;
  }

  return { scanned: recent.length, detected: detected.length, persisted };
}

async function collectSessionMessages(
  session: LeadSession,
  deps: DetectIntentsBatchDeps,
): Promise<string[]> {
  const convs = await deps.conversations.findByLeadId(session.lead_id);
  const out: string[] = [];
  for (const c of convs) {
    const msgs = await deps.messages.listByConversacion(c.id, { limit: 200 });
    for (const m of msgs) {
      if (m.lead_session_id === session.id && m.contenido) {
        out.push(m.contenido);
      }
    }
  }
  return out;
}

export function makeDetectIntentsBatchFn(deps: DetectIntentsBatchDeps) {
  return inngest.createFunction(
    {
      id: "detect-intents.batch",
      triggers: [{ event: detectIntentsBatchRequested }, { cron: "0 3 * * 0" }],
    },
    async ({ step }) => {
      return step.run("detect", async () => {
        try {
          return await detectIntentsBatchHandler({}, deps);
        } catch (e) {
          if (isNonRetriable(e)) {
            throw new NonRetriableError((e as Error).message, { cause: e });
          }
          throw e;
        }
      });
    },
  );
}
