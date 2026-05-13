import { describe, expect, test, vi } from "vitest";
import { dispatchOutboxEventsHandler } from "@/inngest/functions/dispatch-outbox-events.cron";
import { InMemoryEventOutboxRepository } from "@/server/repositories/event-outbox.repo";

describe("dispatchOutboxEventsHandler", () => {
  test("scanned=0 cuando no hay pending", async () => {
    const outbox = new InMemoryEventOutboxRepository();
    const emit = vi.fn().mockResolvedValue(undefined);

    const result = await dispatchOutboxEventsHandler({}, { outbox, inngestEmit: emit });

    expect(result).toEqual({ scanned: 0, sent: 0, failed: 0 });
    expect(emit).not.toHaveBeenCalled();
  });

  test("emit todos los pending + markSent cuando emit succeed", async () => {
    const outbox = new InMemoryEventOutboxRepository();
    await outbox.enqueue({
      event_name: "a.evt",
      event_data: { x: 1 },
      event_id: null,
    });
    await outbox.enqueue({
      event_name: "b.evt",
      event_data: { y: 2 },
      event_id: "dedupe-b",
    });

    const emit = vi.fn().mockResolvedValue(undefined);

    const result = await dispatchOutboxEventsHandler({}, { outbox, inngestEmit: emit });

    expect(result.scanned).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(emit).toHaveBeenCalledTimes(2);

    const pending = await outbox.listPending();
    expect(pending).toHaveLength(0);
  });

  test("emit fail marca attempt + sigue pending", async () => {
    const outbox = new InMemoryEventOutboxRepository();
    await outbox.enqueue({
      event_name: "a.evt",
      event_data: {},
      event_id: null,
    });

    const emit = vi.fn().mockRejectedValue(new Error("Inngest down"));

    const result = await dispatchOutboxEventsHandler({}, { outbox, inngestEmit: emit });

    expect(result.scanned).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);

    const pending = await outbox.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.attempts).toBe(1);
    expect(pending[0]!.last_error).toBe("Inngest down");
  });

  test("emit parcial: 1 succeed + 1 fail registra ambos correctos", async () => {
    const outbox = new InMemoryEventOutboxRepository();
    await outbox.enqueue({ event_name: "ok.evt", event_data: {}, event_id: null });
    await outbox.enqueue({ event_name: "fail.evt", event_data: {}, event_id: null });

    const emit = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("transient"));

    const result = await dispatchOutboxEventsHandler({}, { outbox, inngestEmit: emit });

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);

    const pending = await outbox.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.event_name).toBe("fail.evt");
  });

  test("batchSize limita rows procesados", async () => {
    const outbox = new InMemoryEventOutboxRepository();
    for (let i = 0; i < 5; i++) {
      await outbox.enqueue({ event_name: `evt.${i}`, event_data: {}, event_id: null });
      await new Promise((r) => setTimeout(r, 2));
    }

    const emit = vi.fn().mockResolvedValue(undefined);

    const result = await dispatchOutboxEventsHandler(
      {},
      { outbox, inngestEmit: emit, batchSize: 2 },
    );

    expect(result.scanned).toBe(2);
    expect(emit).toHaveBeenCalledTimes(2);

    const pending = await outbox.listPending();
    expect(pending).toHaveLength(3);
  });

  test("emit recibe event_id cuando outbox row tiene", async () => {
    const outbox = new InMemoryEventOutboxRepository();
    await outbox.enqueue({
      event_name: "lead/created",
      event_data: { leadId: "l1" },
      event_id: "lead-created:l1",
    });

    const emit = vi.fn().mockResolvedValue(undefined);

    await dispatchOutboxEventsHandler({}, { outbox, inngestEmit: emit });

    expect(emit).toHaveBeenCalledWith({
      name: "lead/created",
      data: { leadId: "l1" },
      id: "lead-created:l1",
    });
  });
});
