// @vitest-environment node
/**
 * E2E de "Conectar WhatsApp" contra el mock de la Graph API
 * (`scripts/mock-meta-graph.mjs`), sin Supabase ni Meta ni OpenAI:
 *
 *   mock (proceso real, HTTP) ⇄ clientes Graph reales
 *   mock → webhook firmado → handler real de /api/webhooks/meta (HMAC)
 *        → eventos capturados → servicio de coexistencia con repos en memoria
 *
 * Lo que no cubre: el popup de Facebook en el navegador (no hay mock del SDK),
 * Inngest de verdad (los eventos se pasan a mano al servicio) y Postgres (eso
 * es `tests/integration/whatsapp-numeros.supabase.test.ts`).
 *
 * Cómo correrlo: `npx vitest run tests/e2e/conectar-whatsapp.mock-meta.test.ts`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { makeMetaWebhookHandlers } from "@/app/api/webhooks/meta/route";
import {
  deserializarLote,
  deserializarMensaje,
  type EcoSerializado,
} from "@/lib/meta/parse-coexistencia";
import { llaveroDesdeEnv } from "@/lib/meta/token-cifrado";
import { NoopLogger } from "@/lib/observability/logger";
import { NoopRateLimiter } from "@/lib/rate-limit";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryHandoffEventsRepository } from "@/server/repositories/handoff-events.repo";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryWhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.repo";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultCoexistenciaService } from "@/server/services/meta/coexistencia.service";
import { DefaultConectarWhatsAppService } from "@/server/services/meta/conectar-whatsapp.service";
import { DefaultResolverCredencialesWhatsApp } from "@/server/services/meta/credenciales-whatsapp.service";
import { GraphApiMetaClient } from "@/server/services/meta/graph-api-client";
import { GraphApiOnboardingClient } from "@/server/services/meta/graph-api-onboarding";

const SECRETO = `secreto-e2e-${randomBytes(8).toString("hex")}`;
const TOKEN_ENV = `token-env-${randomBytes(8).toString("hex")}`;
const PHONE_ENV = "100000000000001";
const WABA_COEX = "300000000000009";
const PHONE_COEX = "100000000000009";
const CLIENTE = "12025550188";

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

beforeAll(async () => {
  // Receptor del webhook: el handler real de la ruta, con Inngest capturado.
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
  dirLog = mkdtempSync(join(tmpdir(), "mock-meta-e2e-"));
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
      MOCK_META_COEX_WABA_ID: WABA_COEX,
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

describe("Conectar WhatsApp — E2E contra el mock de Meta", () => {
  test("conectar, sincronizar, recibir historial/contactos/ecos y responder por el número conectado", async () => {
    const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: randomBytes(32).toString("base64") });
    const graph = new GraphApiOnboardingClient({
      graphApiVersion: "v26.0",
      appId: "4242",
      appSecret: SECRETO,
      baseUrl: base,
    });
    const numeros = new InMemoryWhatsAppNumerosRepository();
    const conectados: Array<{ phoneNumberId: string }> = [];

    // 1. El popup devolvió código + WABA; el servidor canjea y guarda.
    const conectar = new DefaultConectarWhatsAppService({
      graph,
      numeros,
      llavero: () => llavero,
      emitirConectado: async (e) => {
        conectados.push(e);
      },
    });
    const r = await conectar.conectar({
      code: "MOCKCODE-0123456789",
      wabaId: WABA_COEX,
      phoneNumberId: null,
      evento: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    });
    expect(r).toMatchObject({ phoneNumberId: PHONE_COEX, modo: "coexistencia" });
    expect(conectados).toEqual([expect.objectContaining({ phoneNumberId: PHONE_COEX })]);
    // El código es de un solo uso.
    await expect(
      conectar.conectar({
        code: "MOCKCODE-0123456789",
        wabaId: WABA_COEX,
        phoneNumberId: null,
        evento: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      }),
    ).rejects.toThrow();

    // 2. Inngest: verificar + contactos + historial, una vez cada uno.
    const leads = new InMemoryLeadsRepository();
    const conversations = new InMemoryConversationsRepository();
    const sessions = new InMemoryLeadSessionRepository();
    const handoffEvents = new InMemoryHandoffEventsRepository(sessions);
    const messages = new InMemoryMessagesRepository();
    const credenciales = new DefaultResolverCredencialesWhatsApp({
      repo: numeros,
      llavero: () => llavero,
    });
    const coex = new DefaultCoexistenciaService({
      numeros,
      graph,
      credenciales,
      leads,
      identificadores: new InMemoryLeadIdentificadoresRepository(),
      conversations,
      sessions,
      messages,
      handoff: new DefaultHandoffService(sessions, undefined, handoffEvents),
      handoffEvents,
    });
    expect(await coex.sincronizarAlConectar(PHONE_COEX)).toEqual({
      verificado: true,
      contactos: "pedido",
      historial: "pedido",
    });
    expect(await coex.sincronizarAlConectar(PHONE_COEX)).toMatchObject({
      contactos: "ya_pedido",
      historial: "ya_pedido",
    });
    const pedidos = (await logDelMock()).filter((e) => e.tipo === "graph.smb_app_data");
    expect(pedidos.map((e) => e.sync_type)).toEqual(["smb_app_state_sync", "history"]);
    expect(pedidos.every((e) => e.token === "negocio")).toBe(true);

    // 3. Meta manda los webhooks (firmados): contactos, historial, eco.
    await control("coex/contactos", { contactos: [{ telefono: CLIENTE, nombre: "Rita Agenda" }] });
    const hist = await control("coex/historial", {
      hilos: [
        {
          telefono: CLIENTE,
          mensajes: [
            { de: "cliente", texto: "¿Tienen pastillas de freno?" },
            { de: "negocio", texto: "Sí, ¿para qué auto?" },
          ],
        },
      ],
      progreso: 100,
    });
    await control("coex/eco", { to: CLIENTE, texto: "Te las guardo hasta mañana" });

    const nombres = eventos.map((e) => e.name);
    expect(nombres).toEqual([
      "meta/coexistencia.contactos",
      "meta/coexistencia.historial",
      "meta/coexistencia.eco",
    ]);
    // Nada de esto entra al pipeline del agente.
    expect(nombres).not.toContain("meta/message.received");

    for (const e of eventos) {
      if (e.name === "meta/coexistencia.contactos") {
        await coex.importarContactos(e.data.contactos as never);
      } else if (e.name === "meta/coexistencia.historial") {
        // Reentrega: el mismo lote dos veces no duplica.
        const lote = deserializarLote(e.data.lote as never);
        await coex.importarHistorial(lote);
        expect(await coex.importarHistorial(lote)).toEqual({ importados: 0, repetidos: 2 });
      } else if (e.name === "meta/coexistencia.eco") {
        const eco = e.data.eco as EcoSerializado;
        const completo = { ...eco, mensaje: deserializarMensaje(eco.mensaje) };
        await coex.registrarEco(completo);
        // El negocio contestó desde el teléfono: la IA de esa conversación se pausa.
        expect(await coex.pausarPorRespuestaDelNegocio(completo)).not.toBeNull();
      }
    }

    const lead = await leads.findByTelefono(CLIENTE);
    expect(lead?.nombre).toBe("Rita Agenda");
    // El historial quedó en una sesión cerrada; la única activa es la del eco, pausada.
    const delLead = await sessions.listByLeadId(lead!.id);
    expect(delLead.filter((s) => s.resultado === null)).toHaveLength(1);
    expect(delLead.filter((s) => s.resultado !== null)).toHaveLength(1);
    expect((await sessions.findActiveByLeadId(lead!.id))?.ia_pausada).toBe(true);
    const conv = await conversations.findByCanalThread("wa", CLIENTE);
    expect(conv?.whatsapp_phone_number_id).toBe(PHONE_COEX);
    // Por la hora real de cada mensaje (el historial es de ayer, el eco de ahora).
    const hilo = (await messages.listByConversacion(conv!.id)).sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime(),
    );
    expect(hilo.map((m) => [m.direction, m.sender, m.contenido])).toEqual([
      ["in", "lead", "¿Tienen pastillas de freno?"],
      ["out", "humano", "Sí, ¿para qué auto?"],
      ["out", "humano", "Te las guardo hasta mañana"],
    ]);
    expect((hist.meta_message_ids as string[]).length).toBe(2);
    expect((await numeros.buscar(PHONE_COEX))?.historial_estado).toBe("completo");

    // 4. Una respuesta desde el CRM sale por el número conectado, con su token.
    const metaApi = new DefaultMetaApiService(
      conversations,
      messages,
      new GraphApiMetaClient({
        graphApiVersion: "v26.0",
        whatsappPhoneNumberId: PHONE_ENV,
        whatsappAccessToken: TOKEN_ENV,
        baseUrl: base,
        credenciales,
      }),
    );
    const sesion = await sessions.findActiveByLeadId(lead!.id);
    await metaApi.sendOutbound({
      conversacionId: conv!.id,
      leadSessionId: sesion!.id,
      canal: "wa",
      to: CLIENTE,
      contenido: "Listo, quedan reservadas",
      sender: "humano",
    });
    const envios = (await logDelMock()).filter((e) => e.tipo === "graph.envio.text");
    expect(envios).toHaveLength(1);
    expect(envios[0]).toMatchObject({ id: PHONE_COEX, token: "negocio" });
  }, 60_000);
});
