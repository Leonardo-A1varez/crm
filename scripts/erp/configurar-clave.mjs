#!/usr/bin/env node
/**
 * Genera la clave de sincronización del ERP para el CRM.
 *
 *   node scripts/erp/configurar-clave.mjs
 *       Imprime la clave UNA vez y la sentencia SQL que fija su hash. La sentencia
 *       se pega en el SQL editor del proyecto Supabase del CRM (crm-dev o el del
 *       cliente). La clave se le pasa al extractor de Bodega Web
 *       (`npm run configurar -- --destino crm` en la PC del dueño).
 *
 *   node scripts/con-stack-local.mjs -- node scripts/erp/configurar-clave.mjs --aplicar-local
 *       Además fija el hash en el stack LOCAL con la service role
 *       (`erp_sync_clave_fijar`). Se niega si la URL no es de loopback.
 *
 * La clave no se escribe en ningún archivo ni se guarda en la base: la base solo
 * tiene su sha256. Si se pierde, se genera otra (la anterior deja de valer en
 * cuanto se fija el hash nuevo).
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function fallar(msg) {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const aplicarLocal = args.includes("--aplicar-local");
for (const a of args) {
  if (a !== "--aplicar-local") fallar(`Argumento desconocido: ${a}`);
}

// 32 bytes aleatorios → 43 caracteres base64url. La RPC exige al menos 32.
const clave = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(clave).digest("hex");

if (aplicarLocal) {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const service = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !service) fallar("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  let host = null;
  try {
    host = new URL(url).hostname;
  } catch {
    host = null;
  }
  if (!host || !LOOPBACK.has(host)) {
    fallar("--aplicar-local solo escribe en el stack local (URL de loopback). Aborto.");
  }
  const db = createClient(url, service, { auth: { persistSession: false } });
  const { error } = await db.rpc("erp_sync_clave_fijar", { p_clave_hash: hash });
  if (error) fallar(`erp_sync_clave_fijar falló: ${error.message}`);
  console.log(`Hash fijado en el stack local (${url}).`);
}

console.log(`
CLAVE DE SINCRONIZACION (se muestra una sola vez; no se guarda en ningun lado):

  ${clave}

Pasala al extractor de Bodega Web. Si se pierde, corré este script de nuevo.

SQL para fijar el hash en el proyecto Supabase del CRM (SQL editor):

  insert into private.erp_sync_config (id, clave_hash, actualizado_at)
  values (1, '${hash}', now())
  on conflict (id) do update
    set clave_hash = excluded.clave_hash, actualizado_at = excluded.actualizado_at;
`);
