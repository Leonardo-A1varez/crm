import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { leadCreated, mergeCandidatesDetectRequested } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { LeadMergeDetectorService } from "@/server/services/lead-merge-detector.service";
import type { UUID } from "@/types/entities";

const DEFAULT_GLOBAL_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DetectMergeCandidatesPerLeadDeps {
  detector: LeadMergeDetectorService;
  // Clock inyectable para tests deterministas (paridad con handler global).
  now?: () => Date;
  logger?: Logger;
}

export interface DetectMergeCandidatesPerLeadInput {
  leadId: UUID;
}

export interface DetectMergeCandidatesResult {
  scanned: number;
  proposed: number;
  recorded: number;
}

/**
 * Handler per-event: corre cuando un lead nuevo es creado. Heurística cheap (compara
 * contra leads creados en window 7d). Detecta dup mismo día (e.g., humano contacta
 * por WA y luego por IG).
 */
export async function detectMergeCandidatesPerLeadHandler(
  input: DetectMergeCandidatesPerLeadInput,
  deps: DetectMergeCandidatesPerLeadDeps,
): Promise<DetectMergeCandidatesResult> {
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "detect-merge-candidates",
    trigger: "per-lead",
    lead_id: input.leadId,
  });
  logger.info("scan-start");

  const proposals = await deps.detector.findCandidatesFor({
    leadId: input.leadId,
    now: deps.now,
  });
  let recorded = 0;
  for (const p of proposals) {
    const created = await deps.detector.recordCandidate(p);
    if (created !== null) recorded++;
  }
  logger.info("scan-complete", { proposed: proposals.length, recorded });
  return { scanned: 1, proposed: proposals.length, recorded };
}

export function makeDetectMergeCandidatesPerLeadFn(deps: DetectMergeCandidatesPerLeadDeps) {
  return inngest.createFunction(
    {
      id: "detect-merge-candidates-per-lead",
      triggers: [{ event: leadCreated }],
    },
    async ({ event, step }) => {
      return step.run("scan", async () => {
        try {
          return await detectMergeCandidatesPerLeadHandler({ leadId: event.data.leadId }, deps);
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

export interface DetectMergeCandidatesGlobalDeps {
  leads: LeadsRepository;
  detector: LeadMergeDetectorService;
  windowDays?: number;
  now?: () => Date;
  logger?: Logger;
}

/**
 * Handler cron daily 5 AM: scan global. Catch races perdidos del per-event
 * handler (e.g., 2 leads creados paralelo donde el primero aún no estaba listo
 * cuando el segundo escaneó). Window 7d para no re-scan todo historial.
 */
export async function detectMergeCandidatesGlobalHandler(
  _input: Record<string, never>,
  deps: DetectMergeCandidatesGlobalDeps,
): Promise<DetectMergeCandidatesResult> {
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "detect-merge-candidates",
    trigger: "global-cron",
  });
  logger.info("scan-start");

  const windowDays = deps.windowDays ?? DEFAULT_GLOBAL_WINDOW_DAYS;
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - windowDays * DAY_MS);

  const all = await deps.leads.list();
  const recent = all.filter((l) => l.created_at >= cutoff);

  let proposed = 0;
  let recorded = 0;
  for (const lead of recent) {
    const proposals = await deps.detector.findCandidatesFor({
      leadId: lead.id,
      windowDays,
      now: deps.now,
    });
    proposed += proposals.length;
    for (const p of proposals) {
      const created = await deps.detector.recordCandidate(p);
      if (created !== null) recorded++;
    }
  }
  logger.info("scan-complete", { scanned: recent.length, proposed, recorded });
  return { scanned: recent.length, proposed, recorded };
}

export function makeDetectMergeCandidatesGlobalFn(deps: DetectMergeCandidatesGlobalDeps) {
  return inngest.createFunction(
    {
      id: "detect-merge-candidates-global",
      triggers: [{ event: mergeCandidatesDetectRequested }, { cron: "0 5 * * *" }],
    },
    async ({ step }) => {
      return step.run("scan", async () => {
        try {
          return await detectMergeCandidatesGlobalHandler({}, deps);
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
