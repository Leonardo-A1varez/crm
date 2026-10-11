// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ConflictError, InfraError, ValidationError } from "@/lib/errors";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMediaStorage } from "@/server/repositories/media-storage.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { DefaultEnviarAdjuntoService } from "@/server/services/media/enviar-adjunto.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import type { MetaMediaClient } from "@/server/services/meta/graph-api-media";
import type { Conversacion, LeadSession } from "@/types/entities";
import { FakeMetaApiClient } from "../../mocks/meta";

let AHORA = new Date();
const HORA = 3600_000;

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const PDF = new Uint8Array([...ascii("%PDF-1.7\n"), ...new Array(100).fill(65)]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(7)]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
const MB = 1024 * 1024;

let sessions: InMemoryLeadSessionRepository;
let convs: InMemoryConversationsRepository;
let messages: InMemoryMessagesRepository;
let storage: InMemoryMediaStorage;
let fakeMeta: FakeMetaApiClient;
let subidasAMeta: Array<{ bytes: Uint8Array; mime: string; nombre: string; desde?: string }>;
let metaMedia: Pick<MetaMediaClient, "subir">;
let reducir: ReturnType<
  typeof vi.fn<(b: Uint8Array, m: string) => Promise<{ bytes: Uint8Array; mime: string } | null>>
>;
let ahora: Date;
let sesion: LeadSession;
let conv: Conversacion;
let leadId: string;

function servicio() {
  return new DefaultEnviarAdjuntoService({
    sessions,
    convs,
    messages,
    metaApi: new DefaultMetaApiService(convs, messages, fakeMeta),
    metaMedia,
    storage,
    reducirImagen: reducir,
    ahora: () => ahora,
  });
}

beforeEach(async () => {
  sessions = new InMemoryLeadSessionRepository();
  convs = new InMemoryConversationsRepository();
  messages = new InMemoryMessagesRepository();
  storage = new InMemoryMediaStorage();
  fakeMeta = new FakeMetaApiClient();
  subidasAMeta = [];
  metaMedia = {
    subir: async (i) => {
      subidasAMeta.push(i);
      return { id: `MEDIA-SUBIDA-${subidasAMeta.length}` };
    },
  };
  reducir = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" }));
  AHORA = new Date(Date.now() + 60_000);
  ahora = AHORA;

  leadId = crypto.randomUUID();
  sesion = await sessions.create({
    lead_id: leadId,
    current_stage: "nuevo",
    urgencia: "media",
    consulta: "",
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
  conv = await convs.create({ lead_id: leadId, canal: "wa", canal_thread_id: "5491122334455" });
  await convs.update(conv.id, { whatsapp_phone_number_id: "PHONE_COEX" });
  // El cliente escribió hace 1 h: ventana abierta.
  await messages.create({
    conversacion_id: conv.id,
    lead_session_id: sesion.id,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: "text",
    contenido: "hola",
    media_url: null,
    meta_message_id: "wamid.IN",
    idempotency_key: null,
    metadata: {},
  });
});

const base = () => ({ leadId, sessionId: sesion.id, canal: "wa" as const });

describe("preparar", () => {
  test("autoriza una subida a una ruta nueva de la sesion, con la extension del tipo", async () => {
    const r = await servicio().preparar({
      ...base(),
      nombre: "lista.pdf",
      mime: "application/pdf",
      bytes: 2 * MB,
    });
    expect(r.ruta).toMatch(new RegExp(`^sesiones/${sesion.id}/[0-9a-f-]{36}\\.pdf$`));
    expect(r.token).toBeTruthy();
    expect(storage.subidasAutorizadas.has(r.ruta)).toBe(true);
  });

  test("solo WhatsApp", async () => {
    await expect(
      servicio().preparar({
        ...base(),
        canal: "ig",
        nombre: "a.pdf",
        mime: "application/pdf",
        bytes: 10,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("tipo o tamano fuera de lo que acepta Meta", async () => {
    await expect(
      servicio().preparar({
        ...base(),
        nombre: "a.exe",
        mime: "application/x-msdownload",
        bytes: 10,
      }),
    ).rejects.toThrow(/no acepta ese tipo/);
    await expect(
      servicio().preparar({ ...base(), nombre: "a.mp4", mime: "video/mp4", bytes: 17 * MB }),
    ).rejects.toThrow(/16 MB/);
    expect(storage.subidasAutorizadas.size).toBe(0);
  });

  test("una foto de 8 MB se acepta (se reduce al enviar)", async () => {
    const r = await servicio().preparar({
      ...base(),
      nombre: "foto.jpg",
      mime: "image/jpeg",
      bytes: 8 * MB,
    });
    expect(r.ruta).toMatch(/\.jpg$/);
  });

  test("sesion cerrada, lead ajeno o ventana cerrada se rechazan antes de subir nada", async () => {
    const pdf = { nombre: "a.pdf", mime: "application/pdf", bytes: 10 };
    await expect(
      servicio().preparar({ ...base(), leadId: crypto.randomUUID(), ...pdf }),
    ).rejects.toBeInstanceOf(ValidationError);

    ahora = new Date(AHORA.getTime() + 25 * HORA);
    // `created_at` del entrante es "ahora real": adelantamos el reloj del servicio.
    await expect(servicio().preparar({ ...base(), ...pdf })).rejects.toThrow(/24 h/);

    ahora = AHORA;
    await sessions.close(sesion.id, { resultado: "perdido", motivo_perdida: "no_responde" });
    await expect(servicio().preparar({ ...base(), ...pdf })).rejects.toBeInstanceOf(ConflictError);
    expect(storage.subidasAutorizadas.size).toBe(0);
  });
});

describe("enviar", () => {
  async function subido(bytes: Uint8Array, ext: string, mime: string, nombre: string) {
    const p = await servicio().preparar({ ...base(), nombre, mime, bytes: bytes.length });
    await storage.subir(p.ruta, bytes, mime);
    return p.ruta;
  }

  test("camino feliz: baja de Storage, sube a Meta con el nombre saneado y el numero de la conversacion, manda con caption", async () => {
    const ruta = await subido(PDF, "pdf", "application/pdf", "lista.pdf");

    const msg = await servicio().enviar({
      ...base(),
      ruta,
      nombre: "..\\..\\Lista Corolla.pdf",
      caption: "  La lista  ",
      userId: "user-1",
    });

    expect(subidasAMeta).toHaveLength(1);
    expect(subidasAMeta[0]).toMatchObject({
      mime: "application/pdf",
      nombre: "Lista Corolla.pdf",
      desde: "PHONE_COEX",
    });
    expect([...subidasAMeta[0]!.bytes]).toEqual([...PDF]);

    expect(fakeMeta.mediaCalls).toEqual([
      {
        to: "5491122334455",
        desde: "PHONE_COEX",
        media: {
          tipo: "doc",
          mediaId: "MEDIA-SUBIDA-1",
          caption: "La lista",
          filename: "Lista Corolla.pdf",
        },
      },
    ]);
    expect(msg).toMatchObject({
      tipo: "doc",
      sender: "humano",
      sender_user_id: "user-1",
      contenido: "La lista",
      media: {
        estado: "descargado",
        path: ruta,
        mime: "application/pdf",
        nombre: "Lista Corolla.pdf",
      },
    });
    expect(msg.media?.bytes).toBe(PDF.length);
  });

  test("una foto que entra en 5 MB sale tal cual, sin reencodear", async () => {
    const ruta = await subido(JPEG, "jpg", "image/jpeg", "foto.jpg");
    const msg = await servicio().enviar({
      ...base(),
      ruta,
      nombre: "foto.jpg",
      caption: null,
      userId: null,
    });
    expect(reducir).not.toHaveBeenCalled();
    expect(msg.media?.path).toBe(ruta);
    expect(msg.media?.mime).toBe("image/jpeg");
  });

  test("una foto de mas de 5 MB se reduce: a Meta va la reducida, el hilo guarda la reducida y la original se borra", async () => {
    const grande = new Uint8Array(6 * MB);
    grande.set(JPEG);
    const ruta = await subido(grande, "jpg", "image/jpeg", "foto.jpg");

    const msg = await servicio().enviar({
      ...base(),
      ruta,
      nombre: "foto.jpg",
      caption: null,
      userId: null,
    });

    expect(reducir).toHaveBeenCalledOnce();
    expect([...subidasAMeta[0]!.bytes]).toEqual([1, 2, 3]);
    expect(msg.media).toMatchObject({ mime: "image/jpeg", bytes: 3 });
    expect(msg.media?.path).not.toBe(ruta);
    expect(msg.media?.path).toMatch(new RegExp(`^sesiones/${sesion.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(storage.objetos.has(ruta)).toBe(false);
    expect(storage.objetos.has(msg.media!.path!)).toBe(true);
  });

  test("si no hay forma de achicarla a 5 MB, error claro y nada sale", async () => {
    reducir.mockResolvedValueOnce(null);
    const grande = new Uint8Array(6 * MB);
    grande.set(JPEG);
    const ruta = await subido(grande, "jpg", "image/jpeg", "foto.jpg");
    await expect(
      servicio().enviar({ ...base(), ruta, nombre: "foto.jpg", caption: null, userId: null }),
    ).rejects.toThrow(/achicar/);
    expect(subidasAMeta).toHaveLength(0);
    expect(fakeMeta.mediaCalls).toHaveLength(0);
  });

  test("el contenido no es lo que dice la extension: se rechaza y no sale nada", async () => {
    const ruta = await subido(HTML, "png", "image/png", "foto.png");
    await expect(
      servicio().enviar({ ...base(), ruta, nombre: "foto.png", caption: null, userId: null }),
    ).rejects.toThrow(/no coincide/);
    expect(subidasAMeta).toHaveLength(0);
  });

  test("rutas ajenas o mal formadas no se aceptan", async () => {
    const otraSesion = `sesiones/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`;
    await storage.subir(otraSesion, PDF, "application/pdf");
    for (const ruta of [
      otraSesion,
      `sesiones/${sesion.id}/../${crypto.randomUUID()}.pdf`,
      `flujos/${crypto.randomUUID()}.png`,
      "",
    ]) {
      await expect(
        servicio().enviar({ ...base(), ruta, nombre: "a.pdf", caption: null, userId: null }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(subidasAMeta).toHaveLength(0);
  });

  test("un archivo que nunca se subio", async () => {
    const ruta = `sesiones/${sesion.id}/${crypto.randomUUID()}.pdf`;
    await expect(
      servicio().enviar({ ...base(), ruta, nombre: "a.pdf", caption: null, userId: null }),
    ).rejects.toThrow(/no se encontr/i);
  });

  test("el audio no admite texto; el caption no pasa de 1024", async () => {
    const OGG = new Uint8Array([...ascii("OggS"), 0, 2, ...new Array(64).fill(7)]);
    const audio = await subido(OGG, "ogg", "audio/ogg", "nota.ogg");
    await expect(
      servicio().enviar({
        ...base(),
        ruta: audio,
        nombre: "nota.ogg",
        caption: "hola",
        userId: null,
      }),
    ).rejects.toThrow(/audio/i);

    const pdf = await subido(PDF, "pdf", "application/pdf", "a.pdf");
    await expect(
      servicio().enviar({
        ...base(),
        ruta: pdf,
        nombre: "a.pdf",
        caption: "x".repeat(1025),
        userId: null,
      }),
    ).rejects.toThrow(/1024/);
    expect(subidasAMeta).toHaveLength(0);
  });

  test("ventana de 24 h cerrada: no sube nada a Meta", async () => {
    const ruta = await subido(PDF, "pdf", "application/pdf", "a.pdf");
    ahora = new Date(AHORA.getTime() + 25 * HORA);
    await expect(
      servicio().enviar({ ...base(), ruta, nombre: "a.pdf", caption: null, userId: null }),
    ).rejects.toThrow(/24 h/);
    expect(subidasAMeta).toHaveLength(0);
  });

  test("doble clic: el segundo envio devuelve el mensaje ya enviado, sin subir ni mandar de nuevo", async () => {
    const ruta = await subido(PDF, "pdf", "application/pdf", "a.pdf");
    const entrada = { ...base(), ruta, nombre: "a.pdf", caption: null, userId: null };
    const a = await servicio().enviar(entrada);
    const b = await servicio().enviar(entrada);
    expect(b.id).toBe(a.id);
    expect(subidasAMeta).toHaveLength(1);
    expect(fakeMeta.mediaCalls).toHaveLength(1);
  });

  test("Meta rechaza la subida: se propaga y no queda ninguna fila en el hilo", async () => {
    const ruta = await subido(PDF, "pdf", "application/pdf", "a.pdf");
    metaMedia = {
      subir: async () => {
        throw new ValidationError("Meta invalid request: tipo no permitido");
      },
    };
    await expect(
      servicio().enviar({ ...base(), ruta, nombre: "a.pdf", caption: null, userId: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      (await messages.listByConversacion(conv.id)).filter((m) => m.direction === "out"),
    ).toHaveLength(0);
  });

  test("falla de infraestructura al subir a Meta: se propaga reintentable", async () => {
    const ruta = await subido(PDF, "pdf", "application/pdf", "a.pdf");
    metaMedia = {
      subir: async () => {
        throw new InfraError("meta caida", "meta");
      },
    };
    await expect(
      servicio().enviar({ ...base(), ruta, nombre: "a.pdf", caption: null, userId: null }),
    ).rejects.toBeInstanceOf(InfraError);
  });
});
