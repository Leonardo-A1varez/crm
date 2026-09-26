#!/usr/bin/env node
/**
 * Genera `.env.stack-local`: el entorno del stack local aislado.
 *
 * - Las claves de Supabase salen de `supabase status -o json` del stack LOCAL
 *   (el CLI no recibe `--linked`: status solo mira los contenedores Docker).
 * - Todo lo demás es de prueba y se genera acá: secreto de app de Meta, token
 *   del mock, claves HMAC de bajas y las contraseñas de los usuarios del seed.
 *   Si el archivo ya existe, esos valores se CONSERVAN (re-correrlo no cambia
 *   contraseñas); solo se refrescan las claves de Supabase.
 * - Nada de esto sirve contra Meta, OpenAI ni crm-dev: la base es 127.0.0.1,
 *   Meta es el mock y el LLM corre en modo mock.
 *
 * El archivo queda ignorado por git (`.env*` en `.gitignore`). No se imprime
 * ningún valor.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destino = resolve(raiz, ".env.stack-local");

const status = spawnSync("supabase", ["status", "-o", "json"], {
  cwd: raiz,
  encoding: "utf8",
  shell: true,
});
const json = status.stdout?.slice(status.stdout.indexOf("{"));
if (status.status !== 0 || !json) {
  console.error("supabase status falló: ¿está levantado el stack? (npm run stack:up)");
  process.exit(1);
}
const s = JSON.parse(json);
const apiUrl = new URL(s.API_URL);
if (!["127.0.0.1", "localhost"].includes(apiUrl.hostname)) {
  console.error(`API_URL no es local (${apiUrl.hostname}); no genero nada`);
  process.exit(1);
}
if (!s.ANON_KEY || !s.SERVICE_ROLE_KEY) {
  console.error("supabase status no devolvió ANON_KEY / SERVICE_ROLE_KEY");
  process.exit(1);
}

const previo = existsSync(destino) ? parseEnv(readFileSync(destino, "utf8")) : {};
const conservar = (clave, generar) => previo[clave] || generar();
const hex = (n) => randomBytes(n).toString("hex");
const clave = (n) => randomBytes(n).toString("base64url");

const PUERTO_APP = 3002;
const PUERTO_INNGEST = 8298;
const PUERTO_MOCK = 55390;
const url = `http://127.0.0.1:${apiUrl.port}`;

const valores = {
  // --- Supabase local (de `supabase status`) ---
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: s.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY,
  // Integration tests contra el MISMO stack local (ver con-stack-local.mjs, perfil test).
  SUPABASE_TEST_URL: url,
  SUPABASE_TEST_SERVICE_KEY: s.SERVICE_ROLE_KEY,

  // --- Inngest dev local, en puertos propios para no chocar con el del dueño ---
  INNGEST_DEV: `http://127.0.0.1:${PUERTO_INNGEST}`,
  INNGEST_EVENT_KEY: "local-dev-event-key",
  INNGEST_SIGNING_KEY: conservar("INNGEST_SIGNING_KEY", () => `signkey-local-${hex(32)}`),
  STACK_LOCAL_INNGEST_PORT: String(PUERTO_INNGEST),

  // --- LLM: mock, nunca OpenAI real ---
  LLM_MODE: "mock",
  OPENAI_API_KEY: "sk-local-mock-sin-uso",
  LLM_DAILY_CAP_USD: "1",

  // --- Meta: todo contra el mock (scripts/mock-meta-graph.mjs) ---
  META_GRAPH_API_BASE_URL: `http://127.0.0.1:${PUERTO_MOCK}`,
  META_GRAPH_API_VERSION: "v26.0",
  META_APP_SECRET: conservar("META_APP_SECRET", () => hex(32)),
  META_VERIFY_TOKEN: conservar("META_VERIFY_TOKEN", () => hex(16)),
  META_WHATSAPP_PHONE_NUMBER_ID: "100000000000001",
  META_WHATSAPP_ACCESS_TOKEN: conservar("META_WHATSAPP_ACCESS_TOKEN", () => `local-${hex(24)}`),
  MOCK_META_PORT: String(PUERTO_MOCK),
  MOCK_META_WABA_ID: "200000000000001",
  MOCK_META_WEBHOOK_URL: `http://127.0.0.1:${PUERTO_APP}/api/webhooks/meta`,

  // --- Bajas de difusión: clave HMAC de prueba (32 bytes) ---
  DIFUSION_BAJAS_HMAC_CLAVES: conservar(
    "DIFUSION_BAJAS_HMAC_CLAVES",
    () => `1:${randomBytes(32).toString("base64")}`,
  ),
  DIFUSION_BAJAS_HMAC_VERSION_ACTIVA: "1",

  // --- App ---
  STACK_LOCAL_PORT: String(PUERTO_APP),

  // --- Usuarios del seed (scripts/stack-local-seed.mjs) ---
  SEED_ADMIN_EMAIL: "admin-local@crm.local",
  SEED_ADMIN_PASSWORD: conservar("SEED_ADMIN_PASSWORD", () => clave(18)),
  SEED_VENDEDOR_EMAIL: "vendedor-local@crm.local",
  SEED_VENDEDOR_PASSWORD: conservar("SEED_VENDEDOR_PASSWORD", () => clave(18)),
};

const lineas = [
  "# Generado por scripts/stack-local-env.mjs — entorno del stack LOCAL aislado.",
  "# Ignorado por git (.env*). No contiene credenciales reales: base 127.0.0.1,",
  "# Meta = mock local, LLM en modo mock. Re-generar: npm run stack:env",
  "# Se usa SIEMPRE a través de scripts/con-stack-local.mjs, que además anula",
  "# cualquier clave de .env.local que no esté acá (ver el runbook).",
  "",
  ...Object.entries(valores).map(([k, v]) => `${k}=${v}`),
  "",
];
writeFileSync(destino, lineas.join("\n"), { mode: 0o600 });
console.log(
  `.env.stack-local escrito (${Object.keys(valores).length} variables, sin imprimir valores)`,
);
