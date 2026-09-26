#!/usr/bin/env node
/**
 * Mock local de la Graph API de Meta. Solo Node, sin dependencias.
 *
 * La app apunta acá con META_GRAPH_API_BASE_URL (ver `.env.stack-local`). Nada
 * de lo que entra sale hacia Meta: responde lo mínimo que los clientes
 * (`graph-api-client.ts`, `graph-api-lectura.ts`) esperan y deja registro de
 * cada pedido en un JSONL que los tests pueden leer.
 *
 * Rutas de la Graph API:
 *   POST /:version/:id/messages               texto, plantilla (WA) o Messenger (IG/FB)
 *   GET  /:version/:phoneId?fields=...        número, límite de mensajería o health_status
 *   GET  /:version/:wabaId/phone_numbers
 *   GET  /:version/:wabaId/message_templates
 *
 * Rutas de control (solo del mock):
 *   GET  /__mock/log                          lo registrado (JSON)
 *   POST /__mock/reset                        vacía el registro
 *   POST /__mock/estado   {meta_message_id, status: delivered|read|failed|sent, codigo?, detalle?}
 *                         arma el webhook de estado, lo firma con el app secret y lo manda a la app
 *   POST /__mock/entrante {from, texto, nombre?}
 *                         simula un WhatsApp entrante (webhook `messages`), firmado igual
 *   POST /__mock/respuesta {from, responde_a, id, titulo, tipo?: "boton"|"lista", nombre?}
 *                         simula que el lead toca un botón o elige una fila de una lista
 *                         (`type: "interactive"`, `button_reply`/`list_reply`, `context.id`
 *                         = `responde_a`), con la forma del ejemplo de Meta. Firmado igual.
 *
 * Los envíos de botones, lista, imagen y ubicación entran por la misma ruta de
 * `messages` y quedan en el log como `graph.envio.interactive`, `graph.envio.image`
 * y `graph.envio.location`, con el cuerpo tal cual.
 *
 * Variables (se leen de `.env.stack-local` si existe; el proceso gana):
 *   MOCK_META_PORT          default 55390
 *   MOCK_META_LOG           default logs/mock-meta.jsonl
 *   MOCK_META_WEBHOOK_URL   default http://127.0.0.1:3002/api/webhooks/meta
 *   META_APP_SECRET         con qué se firma X-Hub-Signature-256 (el de prueba local)
 *   META_WHATSAPP_ACCESS_TOKEN  si viene, el mock exige ese Bearer
 *   META_WHATSAPP_PHONE_NUMBER_ID / MOCK_META_WABA_ID
 *   MOCK_META_RECHAZAR_A    teléfonos (coma) a los que el envío responde 400 código 131026
 *   MOCK_META_AUTO_ESTADOS  "1": tras cada envío WA manda delivered y read solos
 *
 * El token nunca se escribe en el log: se registra solo si vino y si coincidió.
 */
import { createHmac, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archivoEntorno = resolve(raiz, ".env.stack-local");
if (existsSync(archivoEntorno)) process.loadEnvFile(archivoEntorno);

const PUERTO = Number(process.env.MOCK_META_PORT ?? 55390);
const LOG = resolve(raiz, process.env.MOCK_META_LOG ?? "logs/mock-meta.jsonl");
const WEBHOOK = process.env.MOCK_META_WEBHOOK_URL ?? "http://127.0.0.1:3002/api/webhooks/meta";
const APP_SECRET = process.env.META_APP_SECRET ?? "";
const TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN ?? "";
const PHONE_ID = process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "100000000000001";
const WABA_ID = process.env.MOCK_META_WABA_ID ?? "200000000000001";
const RECHAZAR = new Set(
  (process.env.MOCK_META_RECHAZAR_A ?? "")
    .split(",")
    .map((s) => s.replace(/\D/g, ""))
    .filter(Boolean),
);
const AUTO_ESTADOS = process.env.MOCK_META_AUTO_ESTADOS === "1";

const webhookUrl = new URL(WEBHOOK);
if (!["127.0.0.1", "localhost", "[::1]"].includes(webhookUrl.hostname)) {
  console.error(`MOCK_META_WEBHOOK_URL debe ser local; vino ${webhookUrl.hostname}`);
  process.exit(1);
}

mkdirSync(dirname(LOG), { recursive: true });

function registrar(entrada) {
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entrada }) + "\n");
}

function leerLog() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function responder(res, codigo, cuerpo) {
  res.writeHead(codigo, { "content-type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

function errorGraph(res, codigo, code, message) {
  responder(res, codigo, {
    error: { message, type: "OAuthException", code, fbtrace_id: `MOCK${randomUUID().slice(0, 8)}` },
  });
}

async function leerCuerpo(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  return Buffer.concat(partes).toString("utf8");
}

function firmar(cuerpo) {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(cuerpo).digest("hex");
}

async function postWebhook(payload, tipo) {
  if (!APP_SECRET) throw new Error("META_APP_SECRET vacío: no se puede firmar el webhook");
  const cuerpo = JSON.stringify(payload);
  let status = 0;
  let error = null;
  try {
    const r = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Hub-Signature-256": firmar(cuerpo) },
      body: cuerpo,
    });
    status = r.status;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  registrar({ tipo, destino: WEBHOOK, payload, respuesta: status, error });
  return { status, error };
}

function valueBase() {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "15550000001", phone_number_id: PHONE_ID },
  };
}

function payloadWa(value) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: WABA_ID, changes: [{ field: "messages", value }] }],
  };
}

async function emitirEstado({ meta_message_id, status, recipient_id, codigo, detalle }) {
  const estado = {
    id: meta_message_id,
    status,
    timestamp: String(Math.floor(Date.now() / 1000)),
    recipient_id: recipient_id ?? "0",
  };
  if (status === "failed") {
    const code = Number(codigo ?? 131026);
    estado.errors = [
      {
        code,
        title: "Message undeliverable (mock)",
        message: "Message undeliverable (mock)",
        error_data: { details: detalle ?? "Simulado por scripts/mock-meta-graph.mjs" },
      },
    ];
  }
  return postWebhook(payloadWa({ ...valueBase(), statuses: [estado] }), "webhook.estado");
}

const PLANTILLAS = [
  {
    id: "900000000000001",
    name: "hello_world",
    language: "en_US",
    category: "UTILITY",
    status: "APPROVED",
    quality_score: { score: "GREEN" },
    components: [{ type: "BODY", text: "Hello World" }],
  },
  {
    id: "900000000000002",
    name: "promo_repuestos",
    language: "es",
    category: "MARKETING",
    status: "APPROVED",
    quality_score: { score: "GREEN" },
    components: [
      { type: "HEADER", format: "TEXT", text: "Novedades de repuestos" },
      { type: "BODY", text: "Hola {{1}}, tenemos stock para tu {{2}}." },
      { type: "FOOTER", text: "Respondé BAJA para no recibir más" },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quiero saber más" }] },
    ],
  },
];

const NUMERO = {
  id: PHONE_ID,
  display_phone_number: "+1 555-000-0001",
  verified_name: "Repuestos Demo (mock)",
  quality_rating: "GREEN",
};

function autorizado(req) {
  const h = req.headers.authorization ?? "";
  const vino = h.startsWith("Bearer ") && h.length > 7;
  const coincide = TOKEN ? h === `Bearer ${TOKEN}` : vino;
  return { vino, coincide };
}

async function manejarGraph(req, res, segmentos, url) {
  const auth = autorizado(req);
  const base = { metodo: req.method, ruta: url.pathname, token_presente: auth.vino };
  if (!auth.coincide) {
    registrar({ tipo: "graph.rechazado", ...base, motivo: "token" });
    return errorGraph(res, 401, 190, "Invalid OAuth access token (mock)");
  }
  const [, id, recurso] = segmentos;

  if (req.method === "POST" && recurso === "messages") {
    const texto = await leerCuerpo(req);
    let cuerpo;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      registrar({ tipo: "graph.rechazado", ...base, motivo: "json" });
      return errorGraph(res, 400, 100, "Invalid JSON (mock)");
    }
    if (cuerpo.messaging_product === "whatsapp") {
      const to = String(cuerpo.to ?? "").replace(/\D/g, "");
      if (RECHAZAR.has(to)) {
        registrar({ tipo: "graph.envio.rechazado", ...base, cuerpo });
        return errorGraph(res, 400, 131026, "Message undeliverable (mock)");
      }
      const wamid = `wamid.MOCK-${randomUUID()}`;
      registrar({
        tipo: `graph.envio.${cuerpo.type}`,
        ...base,
        id,
        cuerpo,
        meta_message_id: wamid,
      });
      responder(res, 200, {
        messaging_product: "whatsapp",
        contacts: [{ input: cuerpo.to, wa_id: to }],
        messages: [{ id: wamid }],
      });
      if (AUTO_ESTADOS) {
        setTimeout(async () => {
          await emitirEstado({ meta_message_id: wamid, status: "delivered", recipient_id: to });
          // Separados para imitar a Meta. La carrera de "delivered" y "read"
          // juntos ya no retrocede el estado (guarda en el WHERE del UPDATE);
          // para ejercitarla, POST /__mock/estado dos veces a la vez.
          setTimeout(
            () => emitirEstado({ meta_message_id: wamid, status: "read", recipient_id: to }),
            2000,
          );
        }, 500);
      }
      return;
    }
    const mid = `m_MOCK-${randomUUID()}`;
    registrar({ tipo: "graph.envio.messenger", ...base, id, cuerpo, meta_message_id: mid });
    return responder(res, 200, { recipient_id: cuerpo.recipient?.id ?? "0", message_id: mid });
  }

  if (req.method === "GET" && !recurso) {
    const campos = url.searchParams.get("fields") ?? "";
    registrar({ tipo: "graph.lectura", ...base, campos });
    if (campos.includes("health_status")) {
      return responder(res, 200, {
        id,
        health_status: {
          can_send_message: "AVAILABLE",
          entities: [
            { entity_type: "PHONE_NUMBER", id, can_send_message: "AVAILABLE" },
            { entity_type: "WABA", id: WABA_ID, can_send_message: "AVAILABLE" },
            { entity_type: "BUSINESS", id: "300000000000001", can_send_message: "AVAILABLE" },
            { entity_type: "APP", id: "400000000000001", can_send_message: "AVAILABLE" },
          ],
        },
      });
    }
    if (campos.includes("whatsapp_business_manager_messaging_limit")) {
      return responder(res, 200, { id, whatsapp_business_manager_messaging_limit: "TIER_2K" });
    }
    return responder(res, 200, { ...NUMERO, id });
  }

  if (req.method === "GET" && recurso === "phone_numbers") {
    registrar({ tipo: "graph.lectura", ...base });
    return responder(res, 200, { data: [NUMERO], paging: {} });
  }

  if (req.method === "GET" && recurso === "message_templates") {
    registrar({ tipo: "graph.lectura", ...base });
    return responder(res, 200, { data: PLANTILLAS, paging: {} });
  }

  registrar({ tipo: "graph.desconocido", ...base });
  return errorGraph(res, 400, 100, `Ruta no simulada: ${req.method} ${url.pathname}`);
}

async function manejarControl(req, res, url) {
  if (req.method === "GET" && url.pathname === "/__mock/log") {
    return responder(res, 200, leerLog());
  }
  if (req.method === "POST" && url.pathname === "/__mock/reset") {
    writeFileSync(LOG, "");
    return responder(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/__mock/estado") {
    const d = JSON.parse((await leerCuerpo(req)) || "{}");
    if (!d.meta_message_id || !["sent", "delivered", "read", "failed"].includes(d.status)) {
      return responder(res, 400, {
        error: "meta_message_id y status (sent|delivered|read|failed)",
      });
    }
    return responder(res, 200, await emitirEstado(d));
  }
  if (req.method === "POST" && url.pathname === "/__mock/entrante") {
    const d = JSON.parse((await leerCuerpo(req)) || "{}");
    const from = String(d.from ?? "").replace(/\D/g, "");
    if (!from || !d.texto) return responder(res, 400, { error: "from y texto" });
    const wamid = `wamid.MOCK-IN-${randomUUID()}`;
    const r = await postWebhook(
      payloadWa({
        ...valueBase(),
        contacts: [{ profile: { name: d.nombre ?? "Cliente Prueba" }, wa_id: from }],
        messages: [
          {
            from,
            id: wamid,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "text",
            text: { body: String(d.texto) },
          },
        ],
      }),
      "webhook.entrante",
    );
    return responder(res, 200, { ...r, meta_message_id: wamid });
  }
  if (req.method === "POST" && url.pathname === "/__mock/respuesta") {
    const d = JSON.parse((await leerCuerpo(req)) || "{}");
    const from = String(d.from ?? "").replace(/\D/g, "");
    if (!from || !d.responde_a || !d.id || !d.titulo) {
      return responder(res, 400, { error: "from, responde_a, id y titulo" });
    }
    const esLista = d.tipo === "lista";
    const wamid = `wamid.MOCK-IN-${randomUUID()}`;
    const eleccion = { id: String(d.id), title: String(d.titulo) };
    const r = await postWebhook(
      payloadWa({
        ...valueBase(),
        contacts: [{ profile: { name: d.nombre ?? "Cliente Prueba" }, wa_id: from }],
        messages: [
          {
            from,
            id: wamid,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "interactive",
            context: { from: "15550000001", id: String(d.responde_a) },
            interactive: esLista
              ? { type: "list_reply", list_reply: eleccion }
              : { type: "button_reply", button_reply: eleccion },
          },
        ],
      }),
      "webhook.respuesta_interactiva",
    );
    return responder(res, 200, { ...r, meta_message_id: wamid });
  }
  return responder(res, 404, { error: "ruta de control desconocida" });
}

const servidor = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PUERTO}`);
    if (url.pathname.startsWith("/__mock/")) return await manejarControl(req, res, url);
    const segmentos = url.pathname.split("/").filter(Boolean);
    if (/^v\d+\.\d+$/.test(segmentos[0] ?? "") && segmentos.length >= 2) {
      return await manejarGraph(req, res, segmentos, url);
    }
    registrar({ tipo: "desconocido", metodo: req.method, ruta: url.pathname });
    return responder(res, 404, { error: "no simulado" });
  } catch (err) {
    registrar({ tipo: "mock.error", error: err instanceof Error ? err.message : String(err) });
    return responder(res, 500, { error: "error interno del mock" });
  }
});

servidor.listen(PUERTO, "127.0.0.1", () => {
  console.log(`mock-meta-graph escuchando en http://127.0.0.1:${PUERTO} (log: ${LOG})`);
});
