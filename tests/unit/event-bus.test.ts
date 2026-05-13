import { describe, expect, test, vi } from "vitest";
import { InMemoryEventOutboxRepository } from "@/server/repositories/event-outbox.repo";
import { DefaultEventBusService, NoopEventBusService } from "@/server/services/event-bus.service";

describe("DefaultEventBusService", () => {
  test("publish persiste outbox + emit Inngest + markSent en happy path", async () => {
    const outbox = new InMemoryEventOutboxRepository();
    const emit = vi.fn().mockResolvedValue(undefined);

    const bus = new DefaultEventBusService({ outbox, inngestEmit: emit });

    await bus.publish({
      name: "lead-session/turn.completed",
      data: { leadSessionId: "s1", conversationTurn: [] },
    });

    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith({
      name: "lead-session/turn.completed",
      data: { leadSessionId: "s1", conversationTurn: [] },
    });

    const pending = await outbox.listPending();
    expect(pending).toHaveLength(0); // ya sent
  });

  test("publish con emit fail marca attempt + log warn + row sigue pending", async () => {
    const outbox = new InMemoryEventOutboxRepository();
    const emit = vi.fn().mockRejectedValue(new Error("Inngest unreachable"));

    const bus = new DefaultEventBusService({ outbox, inngestEmit: emit });

    await bus.publish({
      name: "lead/created",
      data: { leadId: "l1", canal: "wa" },
    });

    expect(emit).toHaveBeenCalledOnce();

    const pending = await outbox.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe("pending");
    expect(pending[0]!.attempts).toBe(1);
    expect(pending[0]!.last_error).toBe("Inngest unreachable");
  });

  test("publish con event id propaga al outbox + emit", async () => {
    const outbox = new InMemoryEventOutboxRepository();
    const emit = vi.fn().mockResolvedValue(undefined);

    const bus = new DefaultEventBusService({ outbox, inngestEmit: emit });

    await bus.publish({
      name: "lead/created",
      data: { leadId: "l-abc" },
      id: "lead-created:l-abc",
    });

    expect(emit).toHaveBeenCalledWith({
      name: "lead/created",
      data: { leadId: "l-abc" },
      id: "lead-created:l-abc",
    });
  });

  test("publish múltiples emite separadamente y persiste cada uno", async () => {
    const outbox = new InMemoryEventOutboxRepository();
    const emit = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("fail second"));

    const bus = new DefaultEventBusService({ outbox, inngestEmit: emit });

    await bus.publish({ name: "a.evt", data: {} });
    await bus.publish({ name: "b.evt", data: {} });

    expect(emit).toHaveBeenCalledTimes(2);

    const pending = await outbox.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.event_name).toBe("b.evt");
  });
});

describe("NoopEventBusService", () => {
  test("publish silenciosamente", async () => {
    const bus = new NoopEventBusService();
    await expect(bus.publish({ name: "x.y", data: {} })).resolves.toBeUndefined();
  });
});
