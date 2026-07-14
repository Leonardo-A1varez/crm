import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { NoopLogger } from "@/lib/observability/logger";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { makePurgeSession } from "@/inngest/callbacks/purge-session";
import type { LeadSession, UUID } from "@/types/entities";

async function makeClosedSession(repo: InMemoryLeadSessionRepository): Promise<LeadSession> {
  const s = await repo.create({
    lead_id: crypto.randomUUID(),
    current_stage: "cerrado",
    urgencia: "media",
    consulta: "test purge",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
  });
  return repo.close(s.id, { resultado: "perdido", motivo_perdida: "no_responde" });
}

function msg(convId: UUID, sessionId: UUID, mediaUrl: string | null) {
  return {
    conversacion_id: convId,
    lead_session_id: sessionId,
    direction: "in" as const,
    sender: "lead" as const,
    sender_user_id: null,
    tipo: mediaUrl ? ("image" as const) : ("text" as const),
    contenido: mediaUrl ? null : "hola",
    media_url: mediaUrl,
    meta_message_id: null,
    idempotency_key: null,
    metadata: {},
  };
}

describe("makePurgeSession (real)", () => {
  let sessions: InMemoryLeadSessionRepository;
  let messages: InMemoryMessagesRepository;
  let removeMedia: Mock<(paths: string[]) => Promise<void>>;
  let purge: (sessionId: UUID) => Promise<void>;

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    messages = new InMemoryMessagesRepository();
    removeMedia = vi.fn(async (_paths: string[]) => {});
    purge = makePurgeSession({
      sessions,
      messages,
      removeMedia,
      logger: new NoopLogger(),
    });
  });

  test("borra la sesión y limpia solo media del bucket mensajes_media", async () => {
    const session = await makeClosedSession(sessions);
    const convId = crypto.randomUUID();
    await messages.create(
      msg(convId, session.id, "https://x.supabase.co/storage/v1/object/mensajes_media/a/foto.jpg"),
    );
    await messages.create(msg(convId, session.id, null));
    await messages.create(msg(convId, session.id, "https://cdn-externa.com/otra.jpg"));

    await purge(session.id);

    expect(await sessions.findById(session.id)).toBeNull();
    expect(removeMedia).toHaveBeenCalledExactlyOnceWith(["a/foto.jpg"]);
  });

  test("sin media no llama removeMedia", async () => {
    const session = await makeClosedSession(sessions);
    await messages.create(msg(crypto.randomUUID(), session.id, null));

    await purge(session.id);

    expect(removeMedia).not.toHaveBeenCalled();
    expect(await sessions.findById(session.id)).toBeNull();
  });

  test("removeMedia falla → warn y el delete IGUAL ocurre", async () => {
    const session = await makeClosedSession(sessions);
    await messages.create(
      msg(
        crypto.randomUUID(),
        session.id,
        "https://x.supabase.co/storage/v1/object/mensajes_media/b/audio.ogg",
      ),
    );
    removeMedia.mockRejectedValueOnce(new Error("storage caído"));

    await expect(purge(session.id)).resolves.toBeUndefined();
    expect(await sessions.findById(session.id)).toBeNull();
  });

  test("replay: segundo purge de la misma sesión es no-op sin throw", async () => {
    const session = await makeClosedSession(sessions);

    await purge(session.id);
    await expect(purge(session.id)).resolves.toBeUndefined();
  });
});
