import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { autoHandoffEvaluate } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { AllEnabledFeatureFlags, FLAGS, type FeatureFlags } from "@/lib/feature-flags";
import type { HandoffService } from "@/server/services/handoff.service";
import type { IntentClassification } from "@/lib/validation/ai";
import type { UUID } from "@/types/entities";

export interface AutoHandoffDeps {
  handoff: HandoffService;
  flags?: FeatureFlags;
}

export interface AutoHandoffInput {
  leadSessionId: UUID;
  recentClassifications: IntentClassification[];
  threshold?: number;
}

export interface AutoHandoffResult {
  paused: boolean;
  motivo: string;
}

export async function autoHandoffHandler(
  input: AutoHandoffInput,
  deps: AutoHandoffDeps,
): Promise<AutoHandoffResult> {
  const flags = deps.flags ?? new AllEnabledFeatureFlags();
  if (!(await flags.isEnabled(FLAGS.AUTO_HANDOFF_ENABLED))) {
    return { paused: false, motivo: "auto-handoff desactivado por flag" };
  }

  const decision = deps.handoff.evaluate({
    recentClassifications: input.recentClassifications,
    threshold: input.threshold,
  });

  if (!decision.pausar_ia) {
    return { paused: false, motivo: "" };
  }

  await deps.handoff.pause(input.leadSessionId, decision.motivo);
  return { paused: true, motivo: decision.motivo };
}

export function makeAutoHandoffFn(deps: AutoHandoffDeps) {
  return inngest.createFunction(
    { id: "auto-handoff", triggers: [{ event: autoHandoffEvaluate }] },
    async ({ event, step }) => {
      return step.run("eval-and-pause", async () => {
        try {
          return await autoHandoffHandler(
            {
              leadSessionId: event.data.leadSessionId,
              recentClassifications: event.data.recentClassifications,
              threshold: event.data.threshold,
            },
            deps,
          );
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
