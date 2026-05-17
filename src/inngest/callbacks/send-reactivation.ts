/**
 * sendReactivation callback — Slice 1 7.8 STUB.
 *
 * Pilot: logs only (no-op). Wireup real diferido Slice 4:
 *   1. Lookup lead + conversation (channel preferred + canal) + session.
 *   2. Build template message segmentado por `motivo_perdida`.
 *   3. metaApi.sendOutbound({ canal, to, contenido, sender: "ia", ... })
 *   4. Persist reactivation_dispatches row (cooldown enforce).
 *
 * Razón stub: pilot focus = recv loop (webhook → reply). Outbound reactivation
 * es feature ofensiva pre-launch. Habilitar tras Slice 3 RLS + A/B test
 * templates per motivo.
 */

import type { Logger } from "@/lib/observability/logger";
import type {
  ReactivationSendInput,
  ReactivationSendResult,
} from "@/inngest/functions/reactivation-predictor.cron";

export function makeSendReactivation(
  logger: Logger,
): (input: ReactivationSendInput) => Promise<ReactivationSendResult | void> {
  return async (input) => {
    logger.info("sendReactivation.stub", {
      sessionId: input.sessionId,
      leadId: input.leadId,
      motivo: input.motivo,
      note: "Slice 4 wireup real pendiente. Pilot no envía reactivation outbound.",
    });
    // void return = predictor cron registra dispatch attempt sin contenido real.
  };
}
