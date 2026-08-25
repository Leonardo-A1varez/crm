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
import type { OnOperationalReceivedDeps } from "@/inngest/functions/on-operational-received";
import { makeOnOperationalReceivedFn } from "@/inngest/functions/on-operational-received";
import type { OnStatusReceivedDeps } from "@/inngest/functions/on-status-received";
import { makeOnStatusReceivedFn } from "@/inngest/functions/on-status-received";
import type { PurgeOldSessionsDeps } from "@/inngest/functions/purge-old-sessions.cron";
import { makePurgeOldSessionsFn } from "@/inngest/functions/purge-old-sessions.cron";
import type { ReactivationPredictorDeps } from "@/inngest/functions/reactivation-predictor.cron";
import { makeReactivationPredictorFn } from "@/inngest/functions/reactivation-predictor.cron";
import type { RecordatorioSeguimientoDeps } from "@/inngest/functions/recordatorio-seguimiento";
import { makeRecordatorioSeguimientoFn } from "@/inngest/functions/recordatorio-seguimiento";
import type { HandoffNotificationDeps } from "@/inngest/functions/handoff-notification";
import { makeHandoffNotificationFn } from "@/inngest/functions/handoff-notification";
import type { UpdateLeadTwinDeps } from "@/inngest/functions/update-lead-twin";
import { makeUpdateLeadTwinFn } from "@/inngest/functions/update-lead-twin";
import type { DispararWorkflowDeps } from "@/inngest/functions/workflow-disparar";
import { makeWorkflowDispararFn } from "@/inngest/functions/workflow-disparar";
import type { WorkflowSegmentoDeps } from "@/inngest/functions/workflow-segmento";
import { makeWorkflowSegmentoFn } from "@/inngest/functions/workflow-segmento";

export interface CrmInngestDeps {
  onMessageReceived: OnMessageReceivedDeps;
  onStatusReceived: OnStatusReceivedDeps;
  onOperationalReceived: OnOperationalReceivedDeps;
  updateLeadTwin: UpdateLeadTwinDeps;
  detectIntentsBatch: DetectIntentsBatchDeps;
  autoHandoff: AutoHandoffDeps;
  purgeOldSessions: PurgeOldSessionsDeps;
  reactivationPredictor: ReactivationPredictorDeps;
  recordatorioSeguimiento: RecordatorioSeguimientoDeps;
  handoffNotification: HandoffNotificationDeps;
  detectMergeCandidatesPerLead: DetectMergeCandidatesPerLeadDeps;
  detectMergeCandidatesGlobal: DetectMergeCandidatesGlobalDeps;
  dispatchOutboxEvents: DispatchOutboxEventsDeps;
  workflowDisparar: DispararWorkflowDeps;
  workflowSegmento: WorkflowSegmentoDeps;
}

export function makeCrmInngestFunctions(deps: CrmInngestDeps) {
  return [
    makeOnMessageReceivedFn(deps.onMessageReceived),
    makeOnStatusReceivedFn(deps.onStatusReceived),
    makeOnOperationalReceivedFn(deps.onOperationalReceived),
    makeUpdateLeadTwinFn(deps.updateLeadTwin),
    makeDetectIntentsBatchFn(deps.detectIntentsBatch),
    makeAutoHandoffFn(deps.autoHandoff),
    makePurgeOldSessionsFn(deps.purgeOldSessions),
    makeReactivationPredictorFn(deps.reactivationPredictor),
    makeRecordatorioSeguimientoFn(deps.recordatorioSeguimiento),
    makeHandoffNotificationFn(deps.handoffNotification),
    makeDetectMergeCandidatesPerLeadFn(deps.detectMergeCandidatesPerLead),
    makeDetectMergeCandidatesGlobalFn(deps.detectMergeCandidatesGlobal),
    makeDispatchOutboxEventsFn(deps.dispatchOutboxEvents),
    makeWorkflowDispararFn(deps.workflowDisparar),
    makeWorkflowSegmentoFn(deps.workflowSegmento),
  ];
}
