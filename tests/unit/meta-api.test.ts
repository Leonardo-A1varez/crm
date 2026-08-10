import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import type { Conversacion } from "@/types/entities";
import { FakeMetaApiClient } from "../mocks/meta";

async function seedConv(repo: InMemoryConversationsRepository): Promise<Conversacion> {
  return repo.create({
    lead_id: crypto.randomUUID(),
    canal: "wa",
    canal_thread_id: "549110",
  });
}

function parsedFixture(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    canal_thread_id: "549110",
    meta_user_id: "549110",
    meta_message_id: "wamid.X",
    tipo: "text",
    contenido: "hola",
    media_url: null,
    nombre_perfil: null,
    raw: { type: "text" },
    ...overrides,
  };
}

describe("MetaApiService", () => {
  let conversations: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let client: FakeMetaApiClient;
  let svc: DefaultMetaApiService;

  beforeEach(() => {
    conversations = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    client = new FakeMetaApiClient();
    svc = new DefaultMetaApiService(conversations, messages, client);
  });

  describe("sendOutbound", () => {
    test("invoca client.sendText con canal/to/text", async () => {
      const conv = await seedConv(conversations);
      const sessionId = crypto.randomUUID();

      await svc.sendOutbound({
        conversacionId: conv.id,
        leadSessionId: sessionId,
        canal: "wa",
        to: "549110",
        contenido: "respuesta",
        sender: "ia",
      });

      expect(client.calls).toEqual([{ canal: "wa", to: "549110", text: "respuesta" }]);
    });

    test("persiste mensaje direction=out con meta_message_id del client", async () => {
      const conv = await seedConv(conversations);
      const sessionId = crypto.randomUUID();
      client.setMidPrefix("wamid.out-");

      const msg = await svc.sendOutbound({
        conversacionId: conv.id,
        leadSessionId: sessionId,
        canal: "wa",
        to: "549110",
        contenido: "hola",
        sender: "ia",
      });

      expect(msg.direction).toBe("out");
      expect(msg.sender).toBe("ia");
      expect(msg.sender_user_id).toBeNull();
      expect(msg.tipo).toBe("text");
      expect(msg.contenido).toBe("hola");
      expect(msg.meta_message_id).toBe("wamid.out-1");
      expect(msg.conversacion_id).toBe(conv.id);
      expect(msg.lead_session_id).toBe(sessionId);
    });

    test("sender=humano persiste senderUserId", async () => {
      const conv = await seedConv(conversations);
      const userId = crypto.randomUUID();

      const msg = await svc.sendOutbound({
        conversacionId: conv.id,
        leadSessionId: crypto.randomUUID(),
        canal: "wa",
        to: "549110",
        contenido: "humano responde",
        sender: "humano",
        senderUserId: userId,
      });

      expect(msg.sender).toBe("humano");
      expect(msg.sender_user_id).toBe(userId);
    });

    test("touch conversation tras send", async () => {
      const conv = await seedConv(conversations);
      const before = conv.ultima_actividad_at.getTime();
      await new Promise((r) => setTimeout(r, 5));

      await svc.sendOutbound({
        conversacionId: conv.id,
        leadSessionId: crypto.randomUUID(),
        canal: "wa",
        to: "549110",
        contenido: "x",
        sender: "ia",
      });

      const after = await conversations.findById(conv.id);
      expect(after!.ultima_actividad_at.getTime()).toBeGreaterThan(before);
    });
  });

  describe("recordInbound", () => {
    test("persiste mensaje direction=in sender=lead con datos del parsed", async () => {
      const conv = await seedConv(conversations);
      const sessionId = crypto.randomUUID();
      const parsed = parsedFixture({ meta_message_id: "wamid.in1", contenido: "consulta" });

      const msg = await svc.recordInbound({
        conversacionId: conv.id,
        leadSessionId: sessionId,
        parsed,
      });

      expect(msg.direction).toBe("in");
      expect(msg.sender).toBe("lead");
      expect(msg.sender_user_id).toBeNull();
      expect(msg.meta_message_id).toBe("wamid.in1");
      expect(msg.contenido).toBe("consulta");
      expect(msg.tipo).toBe("text");
      expect(msg.conversacion_id).toBe(conv.id);
      expect(msg.lead_session_id).toBe(sessionId);
    });

    test("dedup: meta_message_id ya existe retorna existente sin crear nuevo", async () => {
      const conv = await seedConv(conversations);
      const sessionId = crypto.randomUUID();
      const parsed = parsedFixture({ meta_message_id: "wamid.dup" });

      const first = await svc.recordInbound({
        conversacionId: conv.id,
        leadSessionId: sessionId,
        parsed,
      });
      const second = await svc.recordInbound({
        conversacionId: conv.id,
        leadSessionId: sessionId,
        parsed,
      });

      expect(second.id).toBe(first.id);
      const all = await messages.listByConversacion(conv.id);
      expect(all).toHaveLength(1);
    });

    test("touch conversation tras recordInbound", async () => {
      const conv = await seedConv(conversations);
      const before = conv.ultima_actividad_at.getTime();
      await new Promise((r) => setTimeout(r, 5));

      await svc.recordInbound({
        conversacionId: conv.id,
        leadSessionId: crypto.randomUUID(),
        parsed: parsedFixture({ meta_message_id: "wamid.touch" }),
      });

      const after = await conversations.findById(conv.id);
      expect(after!.ultima_actividad_at.getTime()).toBeGreaterThan(before);
    });

    test("media_url y tipo image copiados al mensaje", async () => {
      const conv = await seedConv(conversations);
      const parsed = parsedFixture({
        tipo: "image",
        contenido: null,
        media_url: "https://cdn.x/img.jpg",
        meta_message_id: "wamid.img",
      });

      const msg = await svc.recordInbound({
        conversacionId: conv.id,
        leadSessionId: crypto.randomUUID(),
        parsed,
      });

      expect(msg.tipo).toBe("image");
      expect(msg.media_url).toBe("https://cdn.x/img.jpg");
      expect(msg.contenido).toBeNull();
    });

    test("metadata incluye raw del parsed", async () => {
      const conv = await seedConv(conversations);
      const rawData = { type: "text", text: { body: "x" }, custom: "z" };
      const parsed = parsedFixture({
        meta_message_id: "wamid.meta",
        raw: rawData,
      });

      const msg = await svc.recordInbound({
        conversacionId: conv.id,
        leadSessionId: crypto.randomUUID(),
        parsed,
      });

      expect(msg.metadata.raw).toEqual(rawData);
    });
  });
});
