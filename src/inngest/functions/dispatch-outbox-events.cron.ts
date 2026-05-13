import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { outboxDispatchRequested } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { EventOutboxRepository } from "@/server/repositories/event-outbox.repo";
import type { InngestEmitFn, PublishedEvent } from "@/server/services/event-bus.service";

const DEFAULT_BATCH_SIZE = 50;

export interface DispatchOutboxEventsDeps {
  outbox: EventOutboxRepository;
  inngestEmit: InngestEmitFn;
  batchSize?: number;
  logger?: Logger;
}

export interface DispatchOutboxEventsResult {
  scanned: number;
  sent: number;
  failed: number;
}

// Permite memoización por Inngest step.run para idempotencia per-row.
export interface OutboxStepRunner {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export const passthroughOutboxStep: OutboxStepRunner = {
  run: (_name, fn) => fn(),
};

export async function dispatchOutboxEventsHandler(
  _input: Record<string, never>,
  deps: DispatchOutboxEventsDeps,
  step: OutboxStepRunner = passthroughOutboxStep,
): Promise<DispatchOutboxEventsResult> {
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "dispatch-outbox-events",
  });
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;

  const pending = await step.run("list-pending", () => deps.outbox.listPending(batchSize));

  if (pending.length === 0) {
    logger.debug("outbox-empty");
    return { scanned: 0, sent: 0, failed: 0 };
  }

  logger.info("outbox-dispatch-start", { count: pending.length });

  let sent = 0;
  let failed = 0;

  for (const row of pending) {
    const event: PublishedEvent = {
      name: row.event_name,
      data: row.event_data,
      id: row.event_id ?? undefined,
    };

    try {
      await step.run(`emit-${row.id}`, () => deps.inngestEmit(event));
      await step.run(`mark-sent-${row.id}`, () => deps.outbox.markSent(row.id));
      sent++;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await step.run(`mark-failed-${row.id}`, () => deps.outbox.markFailedAttempt(row.id, errMsg));
      logger.warn("outbox-emit-failed", {
        outboxId: row.id,
        eventName: row.event_name,
        attempts: row.attempts + 1,
        error: errMsg,
      });
      failed++;
    }
  }

  logger.info("outbox-dispatch-complete", { scanned: pending.length, sent, failed });

  return { scanned: pending.length, sent, failed };
}

function adaptInngestStep(step: {
  run: <U>(name: string, fn: () => Promise<U>) => Promise<unknown>;
}): OutboxStepRunner {
  return {
    run: <T>(name: string, fn: () => Promise<T>): Promise<T> => step.run(name, fn) as Promise<T>,
  };
}

export function makeDispatchOutboxEventsFn(deps: DispatchOutboxEventsDeps) {
  return inngest.createFunction(
    {
      id: "dispatch-outbox-events",
      triggers: [{ event: outboxDispatchRequested }, { cron: "*/1 * * * *" }],
    },
    async ({ step }) => {
      try {
        return await dispatchOutboxEventsHandler({}, deps, adaptInngestStep(step));
      } catch (e) {
        if (isNonRetriable(e)) {
          throw new NonRetriableError((e as Error).message, { cause: e });
        }
        throw e;
      }
    },
  );
}
