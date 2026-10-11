// @vitest-environment node
import { beforeEach, describe, expect, test } from "vitest";
import { InfraError, NotFoundError, RateLimitError, ValidationError } from "@/lib/errors";
import { NoopLogger } from "@/lib/observability/logger";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryMediaStorage } from "@/server/repositories/media-storage.repo";
import { DefaultDescargarMediaService } from "@/server/services/media/descargar-media.service";
import { MediaDemasiadoGrande } from "@/server/services/meta/graph-api-media";
import type { MediaRemota, MetaMediaClient } from "@/server/services/meta/graph-api-media";
import type { Mensaje, MensajeMetadata } from "@/types/entities";

const SESION = "0f5c1a52-3a3f-4ac9-9a4b-1f6ab3a7c2d1";
const CONV = "11111111-2222-4333-8444-555555555555";
const AHORA = new Date("2026-10-12T15:00:00.000Z");
const DIA = 24 * 3600_000;

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(7)]);
const OGG = new Uint8Array([...ascii("OggS"), 0, 2, ...new Array(64).fill(7)]);
const WEBP_STICKER = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), 1, 2, 3]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
const COMPRIMIDA = new Uint8Array([9, 9, 9]);

/** Meta falso: registra los pedidos y responde lo que cada test arme. */
class MetaFalso implements MetaMediaClient {
  obtener: Array<MediaRemota | Error> = [];
  bajar: Array<Uint8Array | Error> = [];
  pedidos: Array<{ id: string; desde?: string }> = [];
  descargas: Array<{ url: string; desde?: string; maxBytes: number }> = [];

  async obtenerMedia(mediaId: string, o: { desde?: string } = {}): Promise<MediaRemota> {
    this.pedidos.push({ id: mediaId, ...(o.desde ? { desde: o.desde } : {}) });
    const r = this.obtener.shift();
    if (!r) throw new Error("obtenerMedia sin respuesta preparada");
    if (r instanceof Error) throw r;
    return r;
  }
  async descargar(url: string, o: { desde?: string; maxBytes: number }): Promise<Uint8Array> {
    this.descargas.push({ url, ...(o.desde ? { desde: o.desde } : {}), maxBytes: o.maxBytes });
    const r = this.bajar.shift();
    if (!r) throw new Error("descargar sin respuesta preparada");
    if (r instanceof Error) throw r;
    return r;
  }
  async subir(): Promise<{ id: string }> {
    throw new Error("no se usa al bajar");
  }
}

const url = (n = 1): MediaRemota => ({
  url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${n}`,
  mime: null,
  bytes: null,
});

let messages: InMemoryMessagesRepository;
let storage: InMemoryMediaStorage;
let meta: MetaFalso;
let comprimidos: number;

function servicio(
  comprimir: (
    b: Uint8Array,
    m: string,
  ) => Promise<{ bytes: Uint8Array; mime: string } | null> = async () => ({
    bytes: COMPRIMIDA,
    mime: "image/webp",
  }),
) {
  return new DefaultDescargarMediaService({
    messages,
    meta,
    storage,
    comprimir: async (b, m) => {
      comprimidos++;
      return comprimir(b, m);
    },
    ahora: () => AHORA,
    logger: new NoopLogger(),
  });
}

async function mensajeConMedia(
  o: {
    tipo?: Mensaje["tipo"];
    mime?: string | null;
    metaId?: string | null;
    metadata?: MensajeMetadata;
    createdAt?: Date;
    nombre?: string | null;
  } = {},
): Promise<Mensaje> {
  const base = await messages.registrarSalienteYaEnviado({
    conversacion_id: CONV,
    lead_session_id: SESION,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: o.tipo ?? "image",
    contenido: null,
    media_url: null,
    media: {
      estado: "pendiente",
      metaId: o.metaId === undefined ? "MEDIA1" : o.metaId,
      path: null,
      mime: o.mime === undefined ? "image/jpeg" : o.mime,
      bytes: null,
      nombre: o.nombre ?? null,
      error: null,
      descargadoAt: null,
    },
    meta_message_id: `wamid.${Math.random().toString(36).slice(2)}`,
    idempotency_key: null,
    metadata: o.metadata ?? {},
    platform_created_at: null,
    created_at: o.createdAt ?? new Date(AHORA.getTime() - 60_000),
    estado_entrega: null,
    estado_entrega_at: null,
  });
  return base;
}

beforeEach(() => {
  messages = new InMemoryMessagesRepository();
  storage = new InMemoryMediaStorage();
  meta = new MetaFalso();
  comprimidos = 0;
});

describe("DefaultDescargarMediaService.descargar", () => {
  test("camino feliz: pide la URL, baja, comprime, sube a la ruta del mensaje y deja descargado", async () => {
    const m = await mensajeConMedia();
    meta.obtener.push(url());
    meta.bajar.push(JPEG);

    const r = await servicio().descargar({ mensajeId: m.id, phoneNumberId: "PHONE_COEX" });

    expect(r).toBe("descargado");
    const esperada = `sesiones/${SESION}/${m.id}.webp`;
    expect(storage.objetos.get(esperada)).toMatchObject({ mime: "image/webp" });
    expect([...storage.objetos.get(esperada)!.bytes]).toEqual([...COMPRIMIDA]);

    const guardado = await messages.findById(m.id);
    expect(guardado?.media).toMatchObject({
      estado: "descargado",
      path: esperada,
      mime: "image/webp",
      bytes: COMPRIMIDA.length,
      error: null,
    });
    expect(guardado?.media?.descargadoAt?.toISOString()).toBe(AHORA.toISOString());
    // El numero de la conversacion viaja a las dos llamadas: el token es el suyo.
    expect(meta.pedidos).toEqual([{ id: "MEDIA1", desde: "PHONE_COEX" }]);
    expect(meta.descargas[0]).toMatchObject({ desde: "PHONE_COEX" });
  });

  test("idempotente: si ya esta descargado no vuelve a llamar a Meta", async () => {
    const m = await mensajeConMedia();
    meta.obtener.push(url());
    meta.bajar.push(JPEG);
    const s = servicio();
    await s.descargar({ mensajeId: m.id, phoneNumberId: null });

    expect(await s.descargar({ mensajeId: m.id, phoneNumberId: null })).toBe("ya_resuelto");
    expect(meta.pedidos).toHaveLength(1);
    expect(storage.objetos.size).toBe(1);
  });

  test("un mensaje inexistente o sin archivo no hace nada", async () => {
    expect(
      await servicio().descargar({ mensajeId: crypto.randomUUID(), phoneNumberId: null }),
    ).toBe("ya_resuelto");
    expect(meta.pedidos).toHaveLength(0);
  });

  test("la URL de Meta vencio (404): pide una nueva y reintenta una vez", async () => {
    const m = await mensajeConMedia();
    meta.obtener.push(url(1), url(2));
    meta.bajar.push(new NotFoundError("vencio", "media_url", "x"), JPEG);

    expect(await servicio().descargar({ mensajeId: m.id, phoneNumberId: null })).toBe("descargado");
    expect(meta.pedidos).toHaveLength(2);
    expect(meta.descargas.map((d) => d.url)).toEqual([url(1).url, url(2).url]);
  });

  test("si la URL nueva tambien da 404, falla reintentable (Inngest reintenta el paso entero)", async () => {
    const m = await mensajeConMedia();
    meta.obtener.push(url(1), url(2));
    meta.bajar.push(
      new NotFoundError("vencio", "media_url", "x"),
      new NotFoundError("vencio", "media_url", "x"),
    );
    await expect(
      servicio().descargar({ mensajeId: m.id, phoneNumberId: null }),
    ).rejects.toBeInstanceOf(InfraError);
    expect((await messages.findById(m.id))?.media?.estado).toBe("pendiente");
  });

  test("errores transitorios de Meta se propagan sin cambiar el estado (para el reintento)", async () => {
    const m = await mensajeConMedia();
    meta.obtener.push(new InfraError("503", "meta"));
    await expect(
      servicio().descargar({ mensajeId: m.id, phoneNumberId: null }),
    ).rejects.toBeInstanceOf(InfraError);
    meta.obtener.push(new RateLimitError("429", "meta"));
    await expect(
      servicio().descargar({ mensajeId: m.id, phoneNumberId: null }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect((await messages.findById(m.id))?.media?.estado).toBe("pendiente");
  });

  test("el id de media ya no existe (400 de Meta): queda fallido, sin reintentos", async () => {
    const m = await mensajeConMedia();
    meta.obtener.push(new ValidationError("Meta invalid request", { code: 100 }));
    expect(await servicio().descargar({ mensajeId: m.id, phoneNumberId: null })).toBe("fallida");
    expect((await messages.findById(m.id))?.media).toMatchObject({
      estado: "fallido",
      error: "media_no_disponible",
    });
  });

  test("si la compresion no mejora (null) guarda el original con su tipo", async () => {
    const m = await mensajeConMedia();
    meta.obtener.push(url());
    meta.bajar.push(JPEG);
    await servicio(async () => null).descargar({ mensajeId: m.id, phoneNumberId: null });

    const g = await messages.findById(m.id);
    expect(g?.media).toMatchObject({
      estado: "descargado",
      mime: "image/jpeg",
      bytes: JPEG.length,
    });
    expect(g?.media?.path).toBe(`sesiones/${SESION}/${m.id}.jpg`);
  });

  test("si la compresion revienta, igual se guarda el original", async () => {
    const m = await mensajeConMedia();
    meta.obtener.push(url());
    meta.bajar.push(JPEG);
    const r = await servicio(async () => {
      throw new Error("sharp se cayo");
    }).descargar({ mensajeId: m.id, phoneNumberId: null });

    expect(r).toBe("descargado");
    expect((await messages.findById(m.id))?.media).toMatchObject({
      estado: "descargado",
      mime: "image/jpeg",
    });
  });

  test("solo las imagenes se comprimen: audio, documentos y stickers pasan tal cual", async () => {
    const voz = await mensajeConMedia({
      tipo: "audio",
      mime: "audio/ogg; codecs=opus",
      metaId: "A",
    });
    meta.obtener.push(url());
    meta.bajar.push(OGG);
    await servicio().descargar({ mensajeId: voz.id, phoneNumberId: null });
    expect((await messages.findById(voz.id))?.media).toMatchObject({
      estado: "descargado",
      mime: "audio/ogg",
      bytes: OGG.length,
    });

    const sticker = await mensajeConMedia({
      tipo: "image",
      mime: "image/webp",
      metaId: "S",
      metadata: { sticker: true },
    });
    meta.obtener.push(url());
    meta.bajar.push(WEBP_STICKER);
    await servicio().descargar({ mensajeId: sticker.id, phoneNumberId: null });
    expect((await messages.findById(sticker.id))?.media).toMatchObject({
      mime: "image/webp",
      bytes: WEBP_STICKER.length,
    });
    expect(comprimidos).toBe(0);
  });

  test("lo que dice ser imagen y es HTML se guarda como binario sin tipo, nunca como imagen", async () => {
    const m = await mensajeConMedia({ mime: "image/png" });
    meta.obtener.push(url());
    meta.bajar.push(HTML);
    await servicio(async () => null).descargar({ mensajeId: m.id, phoneNumberId: null });

    const g = await messages.findById(m.id);
    expect(g?.media).toMatchObject({ estado: "descargado", mime: "application/octet-stream" });
    expect(g?.media?.path).toBe(`sesiones/${SESION}/${m.id}.bin`);
    expect(storage.objetos.get(g!.media!.path!)?.mime).toBe("application/octet-stream");
  });

  test("demasiado grande segun Meta: omitido sin bajar nada", async () => {
    const m = await mensajeConMedia({ tipo: "doc", mime: "application/pdf" });
    meta.obtener.push({ ...url(), bytes: 60 * 1024 * 1024 });
    expect(await servicio().descargar({ mensajeId: m.id, phoneNumberId: null })).toBe("omitida");
    expect(meta.descargas).toHaveLength(0);
    expect((await messages.findById(m.id))?.media).toMatchObject({
      estado: "omitido",
      error: "demasiado_grande",
    });
  });

  test("demasiado grande al bajar (Meta no informo el tamano): omitido", async () => {
    const m = await mensajeConMedia({ tipo: "video", mime: "video/mp4" });
    meta.obtener.push(url());
    meta.bajar.push(new MediaDemasiadoGrande(50 * 1024 * 1024));
    expect(await servicio().descargar({ mensajeId: m.id, phoneNumberId: null })).toBe("omitida");
    expect((await messages.findById(m.id))?.media?.estado).toBe("omitido");
  });

  test("historial de hace mas de 14 dias: omitido sin llamar a Meta (la purga no lo alcanza)", async () => {
    const viejo = await mensajeConMedia({
      metadata: { origen: "historial_app_business" },
      createdAt: new Date(AHORA.getTime() - 15 * DIA),
    });
    expect(await servicio().descargar({ mensajeId: viejo.id, phoneNumberId: null })).toBe(
      "omitida",
    );
    expect(meta.pedidos).toHaveLength(0);
    expect((await messages.findById(viejo.id))?.media).toMatchObject({
      estado: "omitido",
      error: "historial_viejo",
    });

    const reciente = await mensajeConMedia({
      metadata: { origen: "historial_app_business" },
      createdAt: new Date(AHORA.getTime() - 13 * DIA),
      metaId: "R",
    });
    meta.obtener.push(url());
    meta.bajar.push(JPEG);
    expect(await servicio().descargar({ mensajeId: reciente.id, phoneNumberId: null })).toBe(
      "descargado",
    );
  });

  test("un entrante normal viejo (reintento tardio) sigue su curso: el limite es solo del historial", async () => {
    const m = await mensajeConMedia({ createdAt: new Date(AHORA.getTime() - 20 * DIA) });
    meta.obtener.push(url());
    meta.bajar.push(JPEG);
    expect(await servicio().descargar({ mensajeId: m.id, phoneNumberId: null })).toBe("descargado");
  });

  test("sin id de media no hay nada que pedir: fallido", async () => {
    const m = await mensajeConMedia({ metaId: null });
    expect(await servicio().descargar({ mensajeId: m.id, phoneNumberId: null })).toBe("fallida");
    expect((await messages.findById(m.id))?.media).toMatchObject({
      estado: "fallido",
      error: "sin_id_de_media",
    });
  });

  test("si falla la subida a Storage se propaga y el mensaje sigue pendiente", async () => {
    const m = await mensajeConMedia();
    meta.obtener.push(url());
    meta.bajar.push(JPEG);
    storage.fallarProximaSubida = new InfraError("storage caido", "storage");
    await expect(
      servicio().descargar({ mensajeId: m.id, phoneNumberId: null }),
    ).rejects.toBeInstanceOf(InfraError);
    expect((await messages.findById(m.id))?.media?.estado).toBe("pendiente");
  });

  test("reintento tras subir pero antes de registrar: sobrescribe el mismo objeto, no deja uno huerfano", async () => {
    const m = await mensajeConMedia();
    meta.obtener.push(url(), url(2));
    meta.bajar.push(JPEG, JPEG);
    // Primer intento: el registro falla despues de haber subido.
    const original = messages.registrarMediaDescargada.bind(messages);
    let primera = true;
    messages.registrarMediaDescargada = async (...a) => {
      if (primera) {
        primera = false;
        throw new InfraError("db caida", "db");
      }
      return original(...a);
    };
    await expect(
      servicio().descargar({ mensajeId: m.id, phoneNumberId: null }),
    ).rejects.toBeInstanceOf(InfraError);
    expect(storage.objetos.size).toBe(1);
    expect(await servicio().descargar({ mensajeId: m.id, phoneNumberId: null })).toBe("descargado");
    expect(storage.objetos.size).toBe(1);
  });
});

describe("DefaultDescargarMediaService.marcarFallida", () => {
  test("al agotar los reintentos deja fallido con el motivo, solo si seguia pendiente", async () => {
    const m = await mensajeConMedia();
    const s = servicio();
    await s.marcarFallida(m.id, "reintentos_agotados");
    expect((await messages.findById(m.id))?.media).toMatchObject({
      estado: "fallido",
      error: "reintentos_agotados",
    });

    const ok = await mensajeConMedia({ metaId: "OK" });
    meta.obtener.push(url());
    meta.bajar.push(JPEG);
    await s.descargar({ mensajeId: ok.id, phoneNumberId: null });
    await s.marcarFallida(ok.id, "reintentos_agotados");
    expect((await messages.findById(ok.id))?.media?.estado).toBe("descargado");
  });
});
