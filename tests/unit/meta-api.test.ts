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

  describe("sendTemplate", () => {
    const plantilla = { nombre: "seguimiento", idioma: "es", parametrosCuerpo: ["Ana"] };

    test("manda la plantilla por el cliente y la guarda como saliente de tipo template", async () => {
      const conv = await seedConv(conversations);
      const sessionId = crypto.randomUUID();

      const msg = await svc.sendTemplate({
        conversacionId: conv.id,
        leadSessionId: sessionId,
        to: "549110",
        plantilla,
        sender: "sistema",
        idempotencyKey: "wf:r:1",
      });

      expect(client.templateCalls).toEqual([{ to: "549110", plantilla }]);
      expect(client.calls).toEqual([]);
      expect(msg).toMatchObject({
        direction: "out",
        sender: "sistema",
        tipo: "template",
        conversacion_id: conv.id,
        lead_session_id: sessionId,
        meta_message_id: "wamid.fake-1",
        idempotency_key: "wf:r:1",
      });
      // Lo que ve el hilo: qué plantilla salió y con qué valores.
      expect(msg.contenido).toBe("Plantilla «seguimiento»: Ana");
      expect(msg.metadata).toEqual({
        plantilla_meta: { nombre: "seguimiento", idioma: "es", parametros_cuerpo: ["Ana"] },
      });
    });

    test("la misma idempotencyKey no vuelve a llamar a Meta", async () => {
      const conv = await seedConv(conversations);
      const input = {
        conversacionId: conv.id,
        leadSessionId: crypto.randomUUID(),
        to: "549110",
        plantilla,
        sender: "sistema" as const,
        idempotencyKey: "wf:r:2",
      };

      const primero = await svc.sendTemplate(input);
      const segundo = await svc.sendTemplate(input);

      expect(segundo.id).toBe(primero.id);
      expect(client.templateCalls).toHaveLength(1);
    });

    test("un rechazo de Meta queda marcado en el hilo y se relanza", async () => {
      const conv = await seedConv(conversations);
      client.failWith = new Error("template not found");

      await expect(
        svc.sendTemplate({
          conversacionId: conv.id,
          leadSessionId: crypto.randomUUID(),
          to: "549110",
          plantilla,
          sender: "sistema",
          idempotencyKey: "wf:r:3",
        }),
      ).rejects.toThrow("template not found");

      const fila = await messages.findByIdempotencyKey("wf:r:3");
      expect(fila?.estado_entrega).toBe("fallido");
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

describe("MetaApiService — sendRico", () => {
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

  const botones = {
    tipo: "botones" as const,
    cuerpo: "¿Te lo reservo?",
    botones: [
      { id: "si", titulo: "Sí" },
      { id: "no", titulo: "No" },
    ],
  };

  test("botones: sale por el cliente y queda como interactive con el contenido en metadata", async () => {
    const conv = await seedConv(conversations);
    const msg = await svc.sendRico({
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      to: "549110",
      contenido: botones,
      sender: "sistema",
      idempotencyKey: "wf:r:3",
    });
    expect(client.ricoCalls).toEqual([{ to: "549110", contenido: botones }]);
    expect(msg).toMatchObject({
      tipo: "interactive",
      contenido: "¿Te lo reservo?",
      meta_message_id: "wamid.fake-1",
      media_url: null,
    });
    expect(msg.metadata).toEqual({ rico: botones });
  });

  test("imagen por archivo: el hilo guarda la ruta de Storage, nunca la URL firmada", async () => {
    const conv = await seedConv(conversations);
    const msg = await svc.sendRico({
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      to: "549110",
      contenido: {
        tipo: "imagen",
        url: "https://storage.test/firmada?token=SECRETO",
        caption: "Mirá",
      },
      archivo: "flujos/a.jpg",
      sender: "sistema",
    });
    expect(client.ricoCalls[0]?.contenido).toMatchObject({
      url: expect.stringContaining("SECRETO"),
    });
    expect(msg.tipo).toBe("image");
    expect(msg.media_url).toBeNull();
    expect(msg.contenido).toBe("Mirá");
    expect(JSON.stringify(msg.metadata)).not.toContain("SECRETO");
    expect(msg.metadata).toEqual({
      rico: { tipo: "imagen", url: null, archivo: "flujos/a.jpg", caption: "Mirá" },
    });
  });

  test("imagen por URL pública: queda en media_url", async () => {
    const conv = await seedConv(conversations);
    const msg = await svc.sendRico({
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      to: "549110",
      contenido: { tipo: "imagen", url: "https://x.test/a.jpg", caption: null },
      sender: "sistema",
    });
    expect(msg.media_url).toBe("https://x.test/a.jpg");
    expect(msg.contenido).toBeNull();
  });

  test("ubicación: tipo location, el texto es el nombre y la dirección", async () => {
    const conv = await seedConv(conversations);
    const msg = await svc.sendRico({
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      to: "549110",
      contenido: { tipo: "ubicacion", lat: 1, lon: 2, nombre: "Local", direccion: "Av. 1" },
      sender: "sistema",
    });
    expect(msg.tipo).toBe("location");
    expect(msg.contenido).toBe("Local · Av. 1");
  });

  test("misma clave dos veces: Meta recibe uno solo", async () => {
    const conv = await seedConv(conversations);
    const input = {
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      to: "549110",
      contenido: botones,
      sender: "sistema" as const,
      idempotencyKey: "wf:r:9",
    };
    const a = await svc.sendRico(input);
    const b = await svc.sendRico(input);
    expect(b.id).toBe(a.id);
    expect(client.ricoCalls).toHaveLength(1);
  });

  test("recordInbound guarda la opción elegida en metadata", async () => {
    const conv = await seedConv(conversations);
    const msg = await svc.recordInbound({
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      parsed: parsedFixture({
        meta_message_id: "wamid.IN",
        contenido: "Sí",
        respuesta_interactiva: { id: "si", titulo: "Sí", responde_a: "wamid.OUT" },
      }),
    });
    expect(msg.metadata.respuesta_interactiva).toEqual({
      id: "si",
      titulo: "Sí",
      responde_a: "wamid.OUT",
    });
  });
});
