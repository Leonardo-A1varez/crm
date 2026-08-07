/**
 * Smoke outbound Meta Cloud API (Slice 4b).
 *
 * Valida la cadena creds -> Graph API sin levantar Next ni Inngest:
 * token del usuario del sistema + phone number ID + permisos de la WABA.
 *
 * Uso:
 *   node scripts/smoke-meta-send.mjs <destinatario-E164-sin-mas>
 *   node scripts/smoke-meta-send.mjs 5215512345678
 *
 * El destinatario debe estar verificado en la lista de la app Meta (max 5
 * mientras uses el numero de prueba).
 *
 * Manda la plantilla `hello_world` porque sin ventana de 24h abierta Meta
 * rechaza los mensajes de texto libre. La plantilla viene precargada en toda
 * WABA nueva.
 *
 * Nunca imprime el access token.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env.local");

function readEnv(name) {
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (m && m[1] === name) {
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (v) return v;
    }
  }
  return null;
}

const to = process.argv[2]?.replace(/[^\d]/g, "");
if (!to) {
  console.error("Falta el destinatario. Uso: node scripts/smoke-meta-send.mjs 5215512345678");
  process.exit(1);
}

const token = readEnv("META_WHATSAPP_ACCESS_TOKEN");
const phoneNumberId = readEnv("META_WHATSAPP_PHONE_NUMBER_ID");
const version = readEnv("META_GRAPH_API_VERSION") ?? "v21.0";

const missing = [
  !token && "META_WHATSAPP_ACCESS_TOKEN",
  !phoneNumberId && "META_WHATSAPP_PHONE_NUMBER_ID",
].filter(Boolean);

if (missing.length) {
  console.error(`FAIL: falta en .env.local -> ${missing.join(", ")}`);
  process.exit(1);
}

const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
console.log(`POST ${url}`);
console.log(`  destinatario: ${to}`);
console.log(`  plantilla:    hello_world (en_US)\n`);

const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: { name: "hello_world", language: { code: "en_US" } },
  }),
});

const body = await res.json();

if (res.ok) {
  console.log(`OK  status=${res.status}`);
  console.log(`    message_id=${body.messages?.[0]?.id}`);
  console.log(`    estado=${body.messages?.[0]?.message_status ?? "accepted"}`);
  console.log(`\nRevisa tu WhatsApp: deberia llegar "Hello World" desde el numero de prueba.`);
} else {
  console.log(`FAIL status=${res.status}`);
  console.log(`    code=${body.error?.code}  subcode=${body.error?.error_subcode}`);
  console.log(`    type=${body.error?.type}`);
  console.log(`    message=${body.error?.message}`);
  if (body.error?.error_data?.details) {
    console.log(`    details=${body.error.error_data.details}`);
  }
  process.exit(1);
}
