import { beforeEach, describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { FakeMetaApiClient } from "../mocks/meta";

const SESION = "0f5c1a52-3a3f-4ac9-9a4b-1f6ab3a7c2d1";
const OBJETO = "7d9e8a10-0bd4-4b8a-8b43-5c2e1f0a9b77";

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

async function conversacion(numero?: string) {
  const c = await conversations.create({
    lead_id: crypto.randomUUID(),
    canal: "wa",
    canal_thread_id: "5491122334455",
  });
  return numero ? conversations.update(c.id, { whatsapp_phone_number_id: numero }) : c;
}

const archivo = (ext = "pdf") => ({
  path: `sesiones/${SESION}/${OBJETO}.${ext}`,
  mime: "application/pdf",
  bytes: 4096,
  nombre: "lista.pdf",
});

describe("MetaApiService.sendMedia", () => {
  test("manda por el numero de la conversacion y deja el archivo en el hilo, ya descargado", async () => {
    const conv = await conversacion("PHONE_COEX");
    const msg = await svc.sendMedia({
      conversacionId: conv.id,
      leadSessionId: SESION,
      to: "5491122334455",
      media: { tipo: "doc", mediaId: "MEDIA-SUBIDA", caption: "La lista", filename: "lista.pdf" },
      archivo: archivo(),
      sender: "humano",
      senderUserId: "user-1",
    });

    expect(client.mediaCalls).toEqual([
      {
        to: "5491122334455",
        media: { tipo: "doc", mediaId: "MEDIA-SUBIDA", caption: "La lista", filename: "lista.pdf" },
        desde: "PHONE_COEX",
      },
    ]);
    expect(msg).toMatchObject({
      direction: "out",
      sender: "humano",
      sender_user_id: "user-1",
      tipo: "doc",
      contenido: "La lista",
      media: {
        estado: "descargado",
        metaId: "MEDIA-SUBIDA",
        path: archivo().path,
        mime: "application/pdf",
        bytes: 4096,
        nombre: "lista.pdf",
      },
    });
    expect(msg.meta_message_id).toMatch(/^wamid\.fake-/);
    expect(msg.media?.descargadoAt).toBeInstanceOf(Date);
  });

  test("sin numero conectado en la conversacion sale por el de env (sin `desde`)", async () => {
    const conv = await conversacion();
    await svc.sendMedia({
      conversacionId: conv.id,
      leadSessionId: SESION,
      to: "5491122334455",
      media: { tipo: "image", mediaId: "M1", caption: null, filename: null },
      archivo: { ...archivo("jpg"), mime: "image/jpeg", nombre: "foto.jpg" },
      sender: "humano",
    });
    expect(client.mediaCalls[0]).not.toHaveProperty("desde");
  });

  test("sin caption el contenido del mensaje queda null", async () => {
    const conv = await conversacion();
    const msg = await svc.sendMedia({
      conversacionId: conv.id,
      leadSessionId: SESION,
      to: "5491122334455",
      media: { tipo: "audio", mediaId: "A1", caption: null, filename: null },
      archivo: { ...archivo("ogg"), mime: "audio/ogg", nombre: "nota.ogg" },
      sender: "humano",
    });
    expect(msg.tipo).toBe("audio");
    expect(msg.contenido).toBeNull();
  });

  test("idempotente: el mismo envio dos veces no llama dos veces a Meta", async () => {
    const conv = await conversacion();
    const input = {
      conversacionId: conv.id,
      leadSessionId: SESION,
      to: "5491122334455",
      media: { tipo: "image" as const, mediaId: "M2", caption: null, filename: null },
      archivo: { ...archivo("jpg"), mime: "image/jpeg", nombre: "foto.jpg" },
      sender: "humano" as const,
      idempotencyKey: `adjunto:${OBJETO}`,
    };
    const a = await svc.sendMedia(input);
    const b = await svc.sendMedia(input);
    expect(b.id).toBe(a.id);
    expect(client.mediaCalls).toHaveLength(1);
  });

  test("si Meta rechaza (400), la fila queda fallida y visible, y el error se propaga", async () => {
    const conv = await conversacion();
    client.failWith = new ValidationError("Meta invalid request: Media ID not found or expired");
    await expect(
      svc.sendMedia({
        conversacionId: conv.id,
        leadSessionId: SESION,
        to: "5491122334455",
        media: { tipo: "image", mediaId: "M3", caption: null, filename: null },
        archivo: { ...archivo("jpg"), mime: "image/jpeg", nombre: "foto.jpg" },
        sender: "humano",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const [fila] = await messages.listByConversacion(conv.id);
    expect(fila?.estado_entrega).toBe("fallido");
    expect(fila?.error_entrega).toContain("Media ID");
    // El archivo sigue asociado: el vendedor ve que era lo que intento mandar.
    expect(fila?.media?.estado).toBe("descargado");
  });
});
