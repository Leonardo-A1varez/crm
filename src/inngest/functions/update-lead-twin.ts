import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { turnCompleted } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import type { TwinExtractorService } from "@/server/services/twin-extractor.service";
import type { LeadSession, UUID } from "@/types/entities";

export interface UpdateLeadTwinDeps {
  twinExtractor: TwinExtractorService;
}

export interface UpdateLeadTwinInput {
  leadSessionId: UUID;
  conversationTurn: string[];
  mensajeOrigenId?: UUID | null;
}

export async function updateLeadTwinHandler(
  input: UpdateLeadTwinInput,
  deps: UpdateLeadTwinDeps,
): Promise<LeadSession> {
  return deps.twinExtractor.extract({
    sessionId: input.leadSessionId,
    conversationTurn: input.conversationTurn,
    mensajeOrigenId: input.mensajeOrigenId ?? null,
  });
}

export function makeUpdateLeadTwinFn(deps: UpdateLeadTwinDeps) {
  return inngest.createFunction(
    { id: "update-lead-twin", triggers: [{ event: turnCompleted }] },
    async ({ event, step }) => {
      return step.run("extract", async () => {
        try {
          return await updateLeadTwinHandler(
            {
              leadSessionId: event.data.leadSessionId,
              conversationTurn: event.data.conversationTurn,
              mensajeOrigenId: event.data.mensajeOrigenId ?? null,
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
