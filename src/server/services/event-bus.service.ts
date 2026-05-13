import type { Logger } from "@/lib/observability/logger";
import { NoopLogger } from "@/lib/observability/logger";
import {
  NoopEventOutboxRepository,
  type EventOutboxRepository,
} from "@/server/repositories/event-outbox.repo";

export interface PublishedEvent {
  name: string;
  data: Record<string, unknown>;
  // Optional Inngest event deduplication key. Si presente, Inngest dedupe events
  // con mismo id dentro de su window. Útil para idempotency pipeline-level
  // (e.g. lead-created:<leadId>).
  id?: string;
}

export type InngestEmitFn = (event: PublishedEvent) => Promise<void>;

export interface EventBusService {
  // Optimistic-direct + outbox fallback.
  // 1. Persist outbox row (durable record).
  // 2. Try direct inngest emit.
  // 3. Si emit succeeds → markSent.
  // 4. Si emit falla → keep status='pending', cron dispatcher reintenta.
  publish(event: PublishedEvent): Promise<void>;
}

export interface DefaultEventBusServiceOptions {
  outbox: EventOutboxRepository;
  inngestEmit: InngestEmitFn;
  logger?: Logger;
}

export class DefaultEventBusService implements EventBusService {
  private readonly outbox: EventOutboxRepository;
  private readonly inngestEmit: InngestEmitFn;
  private readonly logger: Logger;

  constructor(options: DefaultEventBusServiceOptions) {
    this.outbox = options.outbox;
    this.inngestEmit = options.inngestEmit;
    this.logger = options.logger ?? new NoopLogger();
  }

  async publish(event: PublishedEvent): Promise<void> {
    const row = await this.outbox.enqueue({
      event_name: event.name,
      event_data: event.data,
      event_id: event.id ?? null,
    });

    try {
      await this.inngestEmit(event);
      await this.outbox.markSent(row.id);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await this.outbox.markFailedAttempt(row.id, errMsg);
      this.logger.warn("event-bus direct dispatch failed; cron will retry", {
        outboxId: row.id,
        eventName: event.name,
        error: errMsg,
      });
    }
  }
}

// NoopEventBusService = útil tests que no necesitan tracking eventos.
// Llamadas publish son no-op silenciosas. NO recomendado prod.
export class NoopEventBusService implements EventBusService {
  async publish(_event: PublishedEvent): Promise<void> {
    // no-op
  }
}

// Factory helper para construir bus con repos default.
export function makeDefaultEventBus(
  inngestEmit: InngestEmitFn,
  outbox: EventOutboxRepository = new NoopEventOutboxRepository(),
  logger?: Logger,
): EventBusService {
  return new DefaultEventBusService({ outbox, inngestEmit, logger });
}
