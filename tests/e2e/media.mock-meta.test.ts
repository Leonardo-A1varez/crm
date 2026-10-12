// @vitest-environment node
/**
 * E2E de la media de WhatsApp contra el mock de la Graph API
 * (`scripts/mock-meta-graph.mjs`), sin Supabase, Meta ni OpenAI:
 *
 *   entrante / eco / historial: mock -> webhook firmado -> handler real de la ruta
 *     -> parser -> recordInbound o servicio de coexistencia (repos en memoria)
 *     -> DescargarMediaService con el cliente Graph REAL (HTTP al mock): pide la
 *        URL, baja con el Bearer del número, verifica, comprime con sharp, guarda
 *   saliente: EnviarAdjuntoService -> POST /{phone}/media (multipart real) ->
 *     POST /{phone}/messages con el id
 *
 * No cubre el navegador, Inngest de verdad ni Postgres/Storage reales (eso es
 * tests/integration/mensajes-media.supabase.test.ts).
 *
 * Cómo correrlo: `npx vitest run tests/e2e/media.mock-meta.test.ts`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { makeMetaWebhookHandlers } from "@/app/api/webhooks/meta/route";
import { ValidationError } from "@/lib/errors";
import { deserializarMensaje, type EcoSerializado } from "@/lib/meta/parse-coexistencia";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { NoopLogger } from "@/lib/observability/logger";
import { NoopRateLimiter } from "@/lib/rate-limit";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryHandoffEventsRepository } from "@/server/repositories/handoff-events.repo";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMediaStorage } from "@/server/repositories/media-storage.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryWhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.repo";
import { comprimirImagen, reducirImagenParaEnviar } from "@/server/services/media/comprimir-imagen";
import { DefaultDescargarMediaService } from "@/server/services/media/descargar-media.service";
import { DefaultEnviarAdjuntoService } from "@/server/services/media/enviar-adjunto.service";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultCoexistenciaService } from "@/server/services/meta/coexistencia.service";
import { GraphApiMediaClient } from "@/server/services/meta/graph-api-media";
import { GraphApiMetaClient } from "@/server/services/meta/graph-api-client";

const SECRETO = `secreto-e2e-${randomBytes(8).toString("hex")}`;
const TOKEN_ENV = `token-env-${randomBytes(8).toString("hex")}`;
const PHONE_ENV = "100000000000001";
const PHONE_COEX = "100000000000009";
const CLIENTE = "12025550188";
// El mock deriva el token de negocio del secreto de la app.
const TOKEN_NEGOCIO = `MOCKBIZ${createHmac("sha256", SECRETO).update("token-de-negocio").digest("hex").slice(0, 40)}`;

type Evento = { name: string; data: Record<string, unknown>; id?: string };

async function puertoLibre(): Promise<number> {
  return new Promise((ok, mal) => {
    const s = createNetServer();
    s.once("error", mal);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const p = typeof a === "object" && a ? a.port : 0;
      s.close(() => ok(p));
    });
  });
}

let mock: ChildProcess;
let receptor: Server;
let base: string;
let dirLog: string;
const eventos: Evento[] = [];

async function control(ruta: string, cuerpo: unknown = {}): Promise<Record<string, unknown>> {
  const r = await fetch(`${base}/__mock/${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return (await r.json()) as Record<string, unknown>;
}

async function logDelMock(): Promise<Array<Record<string, unknown>>> {
  return (await (await fetch(`${base}/__mock/log`)).json()) as Array<Record<string, unknown>>;
}

const mediaClient = () =>
  new GraphApiMediaClient({
    graphApiVersion: "v26.0",
    whatsappPhoneNumberId: PHONE_ENV,
    whatsappAccessToken: TOKEN_ENV,
    baseUrl: base,
    credenciales: {
      para: async (id: string) =>
        id === PHONE_COEX ? { phoneNumberId: id, accessToken: TOKEN_NEGOCIO } : null,
    },
  });

beforeAll(async () => {
  const handlers = makeMetaWebhookHandlers({
    appSecret: SECRETO,
    verifyToken: "v",
    inngest: {
      send: (async (e: Evento) => {
        eventos.push(e);
        return { ids: [] };
      }) as never,
    },
    rateLimiter: new NoopRateLimiter(),
    logger: new NoopLogger(),
  });
  const puertoWebhook = await puertoLibre();
  receptor = createServer(async (req, res) => {
    const partes: Buffer[] = [];
    for await (const p of req) partes.push(p as Buffer);
    const r = await handlers.POST(
      new Request(`http://127.0.0.1:${puertoWebhook}${req.url}`, {
        method: "POST",
        headers: { "X-Hub-Signature-256": String(req.headers["x-hub-signature-256"] ?? "") },
        body: Buffer.concat(partes).toString("utf8"),
      }),
    );
    res.writeHead(r.status);
    res.end(await r.text());
  });
  await new Promise<void>((ok) => receptor.listen(puertoWebhook, "127.0.0.1", ok));

  const puertoMock = await puertoLibre();
  base = `http://127.0.0.1:${puertoMock}`;
  dirLog = mkdtempSync(join(tmpdir(), "mock-meta-media-"));
  mock = spawn(process.execPath, [resolve(__dirname, "../../scripts/mock-meta-graph.mjs")], {
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      MOCK_META_PORT: String(puertoMock),
      MOCK_META_LOG: join(dirLog, "mock.jsonl"),
      MOCK_META_WEBHOOK_URL: `http://127.0.0.1:${puertoWebhook}/api/webhooks/meta`,
      META_APP_SECRET: SECRETO,
      META_WHATSAPP_ACCESS_TOKEN: TOKEN_ENV,
      META_WHATSAPP_PHONE_NUMBER_ID: PHONE_ENV,
      MOCK_META_COEX_PHONE_ID: PHONE_COEX,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ok, mal) => {
    const t = setTimeout(() => mal(new Error("el mock no arrancó")), 15_000);
    mock.stdout?.on("data", (d: Buffer) => {
      if (d.toString().includes("escuchando")) {
        clearTimeout(t);
        ok();
      }
    });
    mock.once("exit", (c) => mal(new Error(`el mock salió con ${c}`)));
  });
}, 30_000);

afterAll(async () => {
  mock?.kill();
  await new Promise<void>((ok) => (receptor ? receptor.close(() => ok()) : ok()));
  if (dirLog) rmSync(dirLog, { recursive: true, force: true });
});

/** Una foto "grande": lo que comprime sharp. */
async function fotoGrande(): Promise<Buffer> {
  return sharp(randomBytes(2400 * 1800 * 3), { raw: { width: 2400, height: 1800, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

function armar() {
  const conversations = new InMemoryConversationsRepository();
  const messages = new InMemoryMessagesRepository();
  const storage = new InMemoryMediaStorage();
  const descargar = new DefaultDescargarMediaService({
    messages,
    meta: mediaClient(),
    storage,
    comprimir: comprimirImagen,
  });
  return { conversations, messages, storage, descargar };
}

async function entrantePorWebhook(cuerpo: Record<string, unknown>) {
  const antes = eventos.length;
  const r = await control("media/entrante", { from: CLIENTE, ...cuerpo });
  const nuevos = eventos.slice(antes).filter((e) => e.name === "meta/message.received");
  expect(nuevos).toHaveLength(1);
  return {
    r,
    parsed: nuevos[0]!.data["parsed"] as ParsedMessage & { platform_created_at?: string },
  };
}

describe("media entrante contra el mock de Meta", () => {
  test("foto: webhook -> mensaje pendiente -> descarga con el token de env -> WebP de 1600 px", async () => {
    const { conversations, messages, storage, descargar } = armar();
    const original = await fotoGrande();
    const { parsed } = await entrantePorWebhook({
      tipo: "image",
      mime: "image/jpeg",
      base64: original.toString("base64"),
      caption: "esta pieza",
    });
    expect(parsed).toMatchObject({ tipo: "image", contenido: "esta pieza" });
    expect(parsed.media?.id).toMatch(/^MOCKMEDIA-IN-/);

    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: CLIENTE,
    });
    const sesion = crypto.randomUUID();
    const meta = new DefaultMetaApiService(
      conversations,
      messages,
      new GraphApiMetaClient({
        graphApiVersion: "v26.0",
        whatsappPhoneNumberId: PHONE_ENV,
        whatsappAccessToken: TOKEN_ENV,
        baseUrl: base,
      }),
    );
    const msg = await meta.recordInbound({
      conversacionId: conv.id,
      leadSessionId: sesion,
      parsed: { ...parsed, platform_created_at: undefined },
    });
    expect(msg.media?.estado).toBe("pendiente");

    expect(await descargar.descargar({ mensajeId: msg.id, phoneNumberId: null })).toBe(
      "descargado",
    );

    const guardado = await messages.findById(msg.id);
    expect(guardado?.media).toMatchObject({ estado: "descargado", mime: "image/webp" });
    const objeto = storage.objetos.get(guardado!.media!.path!)!;
    expect(objeto.mime).toBe("image/webp");
    expect(objeto.bytes.length).toBeLessThan(original.length);
    const dims = await sharp(objeto.bytes).metadata();
    expect(Math.max(dims.width ?? 0, dims.height ?? 0)).toBe(1600);

    const log = await logDelMock();
    const descarga = log.filter(
      (e) => e.tipo === "graph.media.descarga" && e.media_id === parsed.media?.id,
    );
    expect(descarga).toHaveLength(1);
    expect(descarga[0]!.token).toBe("env");
  });

  test("la URL vencio (404): pide otra y termina bien", async () => {
    const { conversations, messages, storage, descargar } = armar();
    const { parsed } = await entrantePorWebhook({
      tipo: "image",
      mime: "image/jpeg",
      base64: (await fotoGrande()).toString("base64"),
      urlsVencidas: 1,
    });
    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: `${CLIENTE}1`,
    });
    const meta = new DefaultMetaApiService(
      conversations,
      messages,
      new GraphApiMetaClient({
        graphApiVersion: "v26.0",
        whatsappPhoneNumberId: PHONE_ENV,
        whatsappAccessToken: TOKEN_ENV,
        baseUrl: base,
      }),
    );
    const msg = await meta.recordInbound({
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      parsed,
    });

    expect(await descargar.descargar({ mensajeId: msg.id, phoneNumberId: null })).toBe(
      "descargado",
    );
    expect(storage.objetos.size).toBe(1);

    const log = await logDelMock();
    expect(
      log.filter((e) => e.tipo === "graph.media.url" && e.media_id === parsed.media?.id),
    ).toHaveLength(2);
    expect(
      log.filter((e) => e.tipo === "graph.media.descarga_rechazada" && e.motivo === "url_vencida")
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("nota de voz y PDF se guardan tal cual, con su tipo verificado", async () => {
    const { conversations, messages, storage, descargar } = armar();
    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: `${CLIENTE}2`,
    });
    const meta = new DefaultMetaApiService(
      conversations,
      messages,
      new GraphApiMetaClient({
        graphApiVersion: "v26.0",
        whatsappPhoneNumberId: PHONE_ENV,
        whatsappAccessToken: TOKEN_ENV,
        baseUrl: base,
      }),
    );

    const ogg = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200, 7)]);
    const voz = await entrantePorWebhook({
      tipo: "audio",
      mime: "audio/ogg; codecs=opus",
      base64: ogg.toString("base64"),
      voz: true,
    });
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(300, 9)]);
    const doc = await entrantePorWebhook({
      tipo: "document",
      mime: "application/pdf",
      base64: pdf.toString("base64"),
      nombre: "..\\..\\Lista Corolla.pdf",
    });

    for (const [parsed, esperado] of [
      [voz.parsed, "audio/ogg"],
      [doc.parsed, "application/pdf"],
    ] as const) {
      const msg = await meta.recordInbound({
        conversacionId: conv.id,
        leadSessionId: crypto.randomUUID(),
        parsed,
      });
      await descargar.descargar({ mensajeId: msg.id, phoneNumberId: null });
      const g = await messages.findById(msg.id);
      expect(g?.media).toMatchObject({ estado: "descargado", mime: esperado });
      expect(storage.objetos.get(g!.media!.path!)!.bytes.length).toBe(
        esperado === "audio/ogg" ? ogg.length : pdf.length,
      );
    }
    const guardadoDoc = await messages.findByMetaMessageId(doc.parsed.meta_message_id);
    expect(guardadoDoc?.media?.nombre).toBe("Lista Corolla.pdf");
  });

  test("contenido que no es lo que dice: se guarda como binario sin tipo", async () => {
    const { conversations, messages, storage, descargar } = armar();
    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: `${CLIENTE}3`,
    });
    const meta = new DefaultMetaApiService(
      conversations,
      messages,
      new GraphApiMetaClient({
        graphApiVersion: "v26.0",
        whatsappPhoneNumberId: PHONE_ENV,
        whatsappAccessToken: TOKEN_ENV,
        baseUrl: base,
      }),
    );
    const falsa = await entrantePorWebhook({
      tipo: "image",
      mime: "image/png",
      base64: Buffer.from("<html><script>alert(1)</script></html>").toString("base64"),
    });
    const msg = await meta.recordInbound({
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      parsed: falsa.parsed,
    });
    await descargar.descargar({ mensajeId: msg.id, phoneNumberId: null });
    const g = await messages.findById(msg.id);
    expect(g?.media?.mime).toBe("application/octet-stream");
    expect(storage.objetos.get(g!.media!.path!)!.mime).toBe("application/octet-stream");
  });
});

describe("media de ecos e historial contra el mock de Meta", () => {
  function coexistencia(
    messages: InMemoryMessagesRepository,
    encolar: (d: { mensajeId: string; phoneNumberId: string; fecha: string }) => Promise<void>,
  ) {
    const sessions = new InMemoryLeadSessionRepository();
    const handoffEvents = new InMemoryHandoffEventsRepository(sessions);
    return new DefaultCoexistenciaService({
      numeros: new InMemoryWhatsAppNumerosRepository(),
      graph: {
        leerNumero: async () => {
          throw new Error("no se usa");
        },
        pedirSincronizacion: async () => {
          throw new Error("no se usa");
        },
      },
      credenciales: { para: async () => null },
      leads: new InMemoryLeadsRepository(),
      identificadores: new InMemoryLeadIdentificadoresRepository(),
      conversations: new InMemoryConversationsRepository(),
      sessions,
      messages,
      handoff: new DefaultHandoffService(sessions, undefined, handoffEvents),
      handoffEvents,
      encolarDescargaMedia: encolar,
    });
  }

  test("eco con imagen y follow-up de historial: se encolan y se bajan con el token del numero conectado", async () => {
    const messages = new InMemoryMessagesRepository();
    const storage = new InMemoryMediaStorage();
    const descargar = new DefaultDescargarMediaService({
      messages,
      meta: mediaClient(),
      storage,
      comprimir: comprimirImagen,
    });
    const encoladas: Array<{ mensajeId: string; phoneNumberId: string }> = [];
    const coex = coexistencia(messages, async (d) => void encoladas.push(d));

    const foto = (await fotoGrande()).toString("base64");
    const antes = eventos.length;
    await control("media/eco", {
      to: CLIENTE,
      tipo: "image",
      mime: "image/jpeg",
      base64: foto,
      caption: "te la mando",
    });
    await control("media/historial", {
      from: CLIENTE,
      tipo: "image",
      mime: "image/jpeg",
      base64: foto,
    });
    const nuevos = eventos.slice(antes);

    const eco = nuevos.find((e) => e.name === "meta/coexistencia.eco")!;
    const { eco: e } = eco.data as { eco: EcoSerializado };
    await coex.registrarEco({ ...e, mensaje: deserializarMensaje(e.mensaje) });

    const hist = nuevos.find((e2) => e2.name === "meta/coexistencia.historial")!;
    const { lote } = hist.data as {
      lote: {
        phone_number_id: string;
        fase: null;
        chunk: null;
        progreso: null;
        omitidos: number;
        hilos: Array<{ telefono_cliente: string; mensajes: Array<Record<string, unknown>> }>;
      };
    };
    await coex.importarHistorial({
      ...lote,
      hilos: lote.hilos.map((h) => ({
        ...h,
        mensajes: h.mensajes.map((m) => deserializarMensaje(m as never)),
      })),
    });

    expect(encoladas).toHaveLength(2);
    for (const d of encoladas) {
      expect(d.phoneNumberId).toBe(PHONE_COEX);
      expect(
        await descargar.descargar({ mensajeId: d.mensajeId, phoneNumberId: d.phoneNumberId }),
      ).toBe("descargado");
    }
    const log = await logDelMock();
    expect(
      log.filter((x) => x.tipo === "graph.media.descarga" && x.token === "negocio").length,
    ).toBeGreaterThanOrEqual(2);
    expect(storage.objetos.size).toBe(2);
  });
});

describe("media saliente contra el mock de Meta", () => {
  test("PDF con texto: sube por POST /media (multipart real), manda por id y queda en el hilo", async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryMessagesRepository();
    const sessions = new InMemoryLeadSessionRepository();
    const storage = new InMemoryMediaStorage();
    const leadId = crypto.randomUUID();
    const sesion = await sessions.create({
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
    const conv = await conversations.create({
      lead_id: leadId,
      canal: "wa",
      canal_thread_id: CLIENTE,
    });
    await conversations.update(conv.id, { whatsapp_phone_number_id: PHONE_COEX });
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

    const metaClient = new GraphApiMetaClient({
      graphApiVersion: "v26.0",
      whatsappPhoneNumberId: PHONE_ENV,
      whatsappAccessToken: TOKEN_ENV,
      baseUrl: base,
      credenciales: {
        para: async (id: string) =>
          id === PHONE_COEX ? { phoneNumberId: id, accessToken: TOKEN_NEGOCIO } : null,
      },
    });
    const svc = new DefaultEnviarAdjuntoService({
      sessions,
      convs: conversations,
      messages,
      metaApi: new DefaultMetaApiService(conversations, messages, metaClient),
      metaMedia: mediaClient(),
      storage,
      reducirImagen: reducirImagenParaEnviar,
    });

    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(2000)]);
    const prep = await svc.preparar({
      leadId,
      sessionId: sesion.id,
      canal: "wa",
      nombre: "lista.pdf",
      mime: "application/pdf",
      bytes: pdf.length,
    });
    await storage.subir(prep.ruta, new Uint8Array(pdf), "application/pdf");
    const msg = await svc.enviar({
      leadId,
      sessionId: sesion.id,
      canal: "wa",
      ruta: prep.ruta,
      nombre: "Lista Corolla.pdf",
      caption: "La lista",
      userId: null,
    });

    const log = await logDelMock();
    const subida = log.find(
      (e) => e.tipo === "graph.media.subida" && e.nombre === "Lista Corolla.pdf",
    )!;
    expect(subida).toMatchObject({
      mime: "application/pdf",
      bytes: pdf.length,
      phone_id: PHONE_COEX,
      token: "negocio",
    });
    const envio = log.find((e) => e.tipo === "graph.envio.document")!;
    expect(envio.cuerpo).toMatchObject({
      type: "document",
      to: CLIENTE,
      document: { id: subida.media_id, filename: "Lista Corolla.pdf", caption: "La lista" },
    });
    expect(envio.token).toBe("negocio");

    // El archivo llegó a Meta intacto.
    const devuelto = Buffer.from(
      await (await fetch(`${base}/__mock/media-subida/${String(subida.media_id)}`)).arrayBuffer(),
    );
    expect(devuelto.equals(pdf)).toBe(true);

    expect(msg).toMatchObject({
      tipo: "doc",
      contenido: "La lista",
      media: { estado: "descargado", mime: "application/pdf" },
    });
    expect(msg.meta_message_id).toMatch(/^wamid\.MOCK-/);
  });

  test("Meta rechaza un id de media desconocido: 400 -> ValidationError", async () => {
    const cliente = new GraphApiMetaClient({
      graphApiVersion: "v26.0",
      whatsappPhoneNumberId: PHONE_ENV,
      whatsappAccessToken: TOKEN_ENV,
      baseUrl: base,
    });
    await expect(
      cliente.sendMedia({
        to: CLIENTE,
        media: { tipo: "image", mediaId: "NO-EXISTE", caption: null, filename: null },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("el mock aplica la tabla de Meta: tipo no permitido o tamano excedido se rechazan al subir", async () => {
    const cli = mediaClient();
    await expect(
      cli.subir({
        bytes: new Uint8Array([1, 2, 3]),
        mime: "application/x-msdownload",
        nombre: "a.exe",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      cli.subir({
        bytes: new Uint8Array(5 * 1024 * 1024 + 1),
        mime: "image/jpeg",
        nombre: "grande.jpg",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
