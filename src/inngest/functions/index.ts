import type { AutoHandoffDeps } from "@/inngest/functions/auto-handoff";
import { makeAutoHandoffFn } from "@/inngest/functions/auto-handoff";
import type { DetectIntentsBatchDeps } from "@/inngest/functions/detect-intents.batch";
import { makeDetectIntentsBatchFn } from "@/inngest/functions/detect-intents.batch";
import type {
  DetectMergeCandidatesGlobalDeps,
  DetectMergeCandidatesPerLeadDeps,
} from "@/inngest/functions/detect-merge-candidates";
import {
  makeDetectMergeCandidatesGlobalFn,
  makeDetectMergeCandidatesPerLeadFn,
} from "@/inngest/functions/detect-merge-candidates";
import type { DispatchOutboxEventsDeps } from "@/inngest/functions/dispatch-outbox-events.cron";
import { makeDispatchOutboxEventsFn } from "@/inngest/functions/dispatch-outbox-events.cron";
import type { OnMessageReceivedDeps } from "@/inngest/functions/on-message-received";
import { makeOnMessageReceivedFn } from "@/inngest/functions/on-message-received";
import type { PurgeOldSessionsDeps } from "@/inngest/functions/purge-old-sessions.cron";
import { makePurgeOldSessionsFn } from "@/inngest/functions/purge-old-sessions.cron";
import type { ReactivationPredictorDeps } from "@/inngest/functions/reactivation-predictor.cron";
import { makeReactivationPredictorFn } from "@/inngest/functions/reactivation-predictor.cron";
import type { UpdateLeadTwinDeps } from "@/inngest/functions/update-lead-twin";
import { makeUpdateLeadTwinFn } from "@/inngest/functions/update-lead-twin";

export interface CrmInngestDeps {
  onMessageReceived: OnMessageReceivedDeps;
  updateLeadTwin: UpdateLeadTwinDeps;
  detectIntentsBatch: DetectIntentsBatchDeps;
  autoHandoff: AutoHandoffDeps;
  purgeOldSessions: PurgeOldSessionsDeps;
  reactivationPredictor: ReactivationPredictorDeps;
  detectMergeCandidatesPerLead: DetectMergeCandidatesPerLeadDeps;
  detectMergeCandidatesGlobal: DetectMergeCandidatesGlobalDeps;
  dispatchOutboxEvents: DispatchOutboxEventsDeps;
}

export function makeCrmInngestFunctions(deps: CrmInngestDeps) {
  return [
    makeOnMessageReceivedFn(deps.onMessageReceived),
    makeUpdateLeadTwinFn(deps.updateLeadTwin),
    makeDetectIntentsBatchFn(deps.detectIntentsBatch),
    makeAutoHandoffFn(deps.autoHandoff),
    makePurgeOldSessionsFn(deps.purgeOldSessions),
    makeReactivationPredictorFn(deps.reactivationPredictor),
    makeDetectMergeCandidatesPerLeadFn(deps.detectMergeCandidatesPerLead),
    makeDetectMergeCandidatesGlobalFn(deps.detectMergeCandidatesGlobal),
    makeDispatchOutboxEventsFn(deps.dispatchOutboxEvents),
  ];
}
