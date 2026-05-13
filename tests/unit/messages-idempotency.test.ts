import { beforeEach, describe, expect, test } from "vitest";
import { ConflictError } from "@/lib/errors";
import {
  InMemoryMessagesRepository,
  type MensajeInsert,
} from "@/server/repositories/messages.repo";

function base(overrides: Partial<MensajeInsert> = {}): MensajeInsert {
  return {
    conversacion_id: "conv-1",
    lead_session_id: "session-1",
    direction: "out",
    sender: "ia",
    sender_user_id: null,
    tipo: "text",
    contenido: "respuesta",
    media_url: null,
    meta_message_id: null,
    idempotency_key: null,
    metadata: {},
    ...overrides,
  };
}

describe("MessagesRepository idempotency outbound", () => {
  let repo: InMemoryMessagesRepository;

  beforeEach(() => {
    repo = new InMemoryMessagesRepository();
  });

  test("create out con idempotency_key persiste", async () => {
    const m = await repo.create(base({ idempotency_key: "out:wamid.1" }));
    expect(m.idempotency_key).toBe("out:wamid.1");
  });

  test("create out segunda vez mismo key lanza ConflictError", async () => {
    await repo.create(base({ idempotency_key: "out:wamid.X" }));
    await expect(repo.create(base({ idempotency_key: "out:wamid.X" }))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  test("create out con idempotency_key=null permite múltiples", async () => {
    await repo.create(base({ idempotency_key: null }));
    await repo.create(base({ idempotency_key: null }));
    const all = await repo.listByConversacion("conv-1");
    expect(all).toHaveLength(2);
  });

  test("create in con idempotency_key NO compite con out (UNIQUE partial)", async () => {
    await repo.create(base({ direction: "out", idempotency_key: "shared-key" }));
    // Inbound with same key value should pass (UNIQUE filter direction='out').
    const m = await repo.create(
      base({ direction: "in", sender: "lead", idempotency_key: "shared-key" }),
    );
    expect(m.idempotency_key).toBe("shared-key");
  });

  test("findByIdempotencyKey localiza out con key", async () => {
    const m = await repo.create(base({ idempotency_key: "k1" }));
    const found = await repo.findByIdempotencyKey("k1");
    expect(found?.id).toBe(m.id);
  });

  test("findByIdempotencyKey ignora mensajes inbound", async () => {
    await repo.create(base({ direction: "in", sender: "lead", idempotency_key: "in-key" }));
    expect(await repo.findByIdempotencyKey("in-key")).toBeNull();
  });

  test("findByIdempotencyKey retorna null cuando key no existe", async () => {
    expect(await repo.findByIdempotencyKey("nope")).toBeNull();
  });
});
