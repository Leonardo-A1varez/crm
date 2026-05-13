import { beforeEach, describe, expect, test } from "vitest";
import type {
  EventOutboxInsert,
  EventOutboxRepository,
} from "@/server/repositories/event-outbox.repo";

function baseInsert(overrides: Partial<EventOutboxInsert> = {}): EventOutboxInsert {
  return {
    event_name: "lead-session/turn.completed",
    event_data: { leadSessionId: "session-1", conversationTurn: ["lead: hola"] },
    event_id: null,
    ...overrides,
  };
}

export function runEventOutboxContract(makeRepo: () => EventOutboxRepository) {
  describe("EventOutboxRepository contract", () => {
    let repo: EventOutboxRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    test("enqueue asigna id + created_at + persiste con status default 'pending'", async () => {
      const r = await repo.enqueue(baseInsert());
      expect(r.id).toBeTypeOf("string");
      expect(r.created_at).toBeInstanceOf(Date);
      expect(r.status).toBe("pending");
      expect(r.attempts).toBe(0);
      expect(r.last_error).toBeNull();
      expect(r.sent_at).toBeNull();
      expect(r.event_name).toBe("lead-session/turn.completed");

      const found = await repo.findById(r.id);
      expect(found?.id).toBe(r.id);
      expect(found?.event_data).toEqual(r.event_data);
    });

    test("enqueue deep-clona event_data (defense vs caller mutation)", async () => {
      const payload = { leadSessionId: "session-X" };
      const r = await repo.enqueue(baseInsert({ event_data: payload }));
      payload.leadSessionId = "MUTADO";

      const refetch = await repo.findById(r.id);
      expect(refetch?.event_data["leadSessionId"]).toBe("session-X");
    });

    test("listPending retorna solo status='pending' ordenados ASC por scheduled_at", async () => {
      await repo.enqueue(baseInsert({ event_name: "evt.a" }));
      await new Promise((r) => setTimeout(r, 5));
      await repo.enqueue(baseInsert({ event_name: "evt.b" }));
      await new Promise((r) => setTimeout(r, 5));
      const third = await repo.enqueue(baseInsert({ event_name: "evt.c" }));

      await repo.markSent(third.id);

      const pending = await repo.listPending();
      expect(pending).toHaveLength(2);
      expect(pending[0]!.event_name).toBe("evt.a");
      expect(pending[1]!.event_name).toBe("evt.b");
    });

    test("listPending respeta limit", async () => {
      for (let i = 0; i < 5; i++) {
        await repo.enqueue(baseInsert({ event_name: `evt.${i}` }));
        await new Promise((r) => setTimeout(r, 2));
      }
      const limited = await repo.listPending(2);
      expect(limited).toHaveLength(2);
    });

    test("listPending no retorna scheduled_at futuros", async () => {
      const future = new Date(Date.now() + 60_000);
      await repo.enqueue(baseInsert({ event_name: "evt.future", scheduled_at: future }));
      await repo.enqueue(baseInsert({ event_name: "evt.now" }));

      const pending = await repo.listPending();
      expect(pending.map((r) => r.event_name)).toEqual(["evt.now"]);
    });

    test("markSent setea status='sent' + sent_at + idempotente", async () => {
      const r = await repo.enqueue(baseInsert());
      await repo.markSent(r.id);

      const after = await repo.findById(r.id);
      expect(after?.status).toBe("sent");
      expect(after?.sent_at).toBeInstanceOf(Date);

      // Idempotente: 2da llamada no-op no throw.
      await repo.markSent(r.id);
      const again = await repo.findById(r.id);
      expect(again?.status).toBe("sent");
    });

    test("markSent en id inexistente = no-op", async () => {
      await expect(repo.markSent("nonexistent-id")).resolves.toBeUndefined();
    });

    test("markFailedAttempt incrementa attempts + persiste last_error", async () => {
      const r = await repo.enqueue(baseInsert());
      await repo.markFailedAttempt(r.id, "Inngest timeout");

      const after = await repo.findById(r.id);
      expect(after?.attempts).toBe(1);
      expect(after?.last_error).toBe("Inngest timeout");
      expect(after?.status).toBe("pending"); // sigue pending para retry

      await repo.markFailedAttempt(r.id, "Connection reset");
      const after2 = await repo.findById(r.id);
      expect(after2?.attempts).toBe(2);
      expect(after2?.last_error).toBe("Connection reset");
    });

    test("event_id opcional persiste correcto", async () => {
      const r = await repo.enqueue(baseInsert({ event_id: "lead-created:abc-123" }));
      const found = await repo.findById(r.id);
      expect(found?.event_id).toBe("lead-created:abc-123");
    });
  });
}
