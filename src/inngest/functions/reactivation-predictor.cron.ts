import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { leadsReactivationRequested } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { AllEnabledFeatureFlags, FLAGS, type FeatureFlags } from "@/lib/feature-flags";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import {
  NoopReactivationDispatchesRepository,
  type ReactivationDispatchesRepository,
} from "@/server/repositories/reactivation-dispatches.repo";
import type { MotivoPerdida } from "@/types/domain";
import type { ReactivationDispatchStatus, UUID } from "@/types/entities";

const DEFAULT_WINDOW_DAYS = 60;
const DEFAULT_COOLDOWN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TEMPLATE_NAME = "reactivacion_generica_v1";

export interface ReactivationSendInput {
  sessionId: UUID;
  leadId: UUID;
  motivo: MotivoPerdida | null;
}

export interface ReactivationSendResult {
  templateName?: string;
  metaMessageId?: string | null;
  status?: ReactivationDispatchStatus;
}

export interface ReactivationPredictorDeps {
  sessions: LeadSessionRepository;
  // Tracking dispatches: enforces cooldown via DB (no Date math) + persiste audit
  // post-send. Default Noop = legacy callers sin tracking (siempre dispatch).
  dispatches?: ReactivationDispatchesRepository;
  sendReactivation: (input: ReactivationSendInput) => Promise<ReactivationSendResult | void>;
  windowDays?: number;
  cooldownDays?: number;
  now?: () => Date;
  flags?: FeatureFlags;
}

export interface ReactivationPredictorResult {
  scanned: number;
  dispatched: number;
  skippedCooldown: number;
}

export async function reactivationPredictorHandler(
  _input: Record<string, never>,
  deps: ReactivationPredictorDeps,
): Promise<ReactivationPredictorResult> {
  const flags = deps.flags ?? new AllEnabledFeatureFlags();
  if (!(await flags.isEnabled(FLAGS.REACTIVATION_ENABLED))) {
    return { scanned: 0, dispatched: 0, skippedCooldown: 0 };
  }

  const dispatches = deps.dispatches ?? new NoopReactivationDispatchesRepository();
  const now = (deps.now ?? (() => new Date()))();
  const windowDays = deps.windowDays ?? DEFAULT_WINDOW_DAYS;
  const cooldownDays = deps.cooldownDays ?? DEFAULT_COOLDOWN_DAYS;
  const cooldownMs = cooldownDays * DAY_MS;

  const upperBound = new Date(now.getTime() - cooldownDays * DAY_MS);
  const lowerBound = new Date(now.getTime() - windowDays * DAY_MS);

  const allClosed = await deps.sessions.listClosedBefore(upperBound);
  const lost = allClosed.filter(
    (s) =>
      s.resultado === "perdido" &&
      s.closed_at !== null &&
      s.closed_at >= lowerBound &&
      s.closed_at < upperBound,
  );

  let dispatched = 0;
  let skippedCooldown = 0;

  for (const s of lost) {
    const latest = await dispatches.findLatestBySessionId(s.id);
    if (latest !== null && now.getTime() - latest.created_at.getTime() < cooldownMs) {
      skippedCooldown++;
      continue;
    }

    const result = await deps.sendReactivation({
      sessionId: s.id,
      leadId: s.lead_id,
      motivo: s.motivo_perdida,
    });

    await dispatches.create({
      lead_session_id: s.id,
      motivo: s.motivo_perdida,
      template_name: result?.templateName ?? DEFAULT_TEMPLATE_NAME,
      meta_message_id: result?.metaMessageId ?? null,
      status: result?.status ?? "sent",
    });

    dispatched++;
  }

  return { scanned: lost.length, dispatched, skippedCooldown };
}

export function makeReactivationPredictorFn(deps: ReactivationPredictorDeps) {
  return inngest.createFunction(
    {
      id: "reactivation-predictor",
      triggers: [{ event: leadsReactivationRequested }, { cron: "0 9 * * 1" }],
    },
    async ({ step }) => {
      return step.run("predict", async () => {
        try {
          return await reactivationPredictorHandler({}, deps);
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
