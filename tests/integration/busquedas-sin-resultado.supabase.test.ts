import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PermissionDeniedError } from "@/lib/errors";
import type { Database } from "@/server/db/types.gen";
import { SupabaseBusquedasSinResultadoRepository } from "@/server/repositories/busquedas-sin-resultado.supabase.repo";
import { runBusquedasSinResultadoContract } from "../repositories/busquedas-sin-resultado.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

// La función SQL `busquedas_sin_resultado` es admin-only (la RLS de tool_executions
// deja leer a vendedores). El contrato corre con un cliente admin autenticado.

type Authed = SupabaseClient<Database>;

const PASSWORD = "busquedas-sin-resultado-2026!secret";
const EMAILS = {
  admin: "busquedas-admin@crm.local",
  vendedor: "busquedas-vendedor@crm.local",
} as const;

let service: TestClient;
let admin: Authed;
let vendedor: Authed;
let anon: Authed;
let sessionId: string;
const userIds: string[] = [];

function nuevoCliente(): Authed {
  const url = process.env["SUPABASE_TEST_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !key) {
    throw new Error("RLS tests requieren SUPABASE_TEST_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function crearUsuario(email: string, rol: "admin" | "vendedor"): Promise<string> {
  const app_metadata = { rol };
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata,
  });
  if (!error) return data.user.id;
  if (!error.message.toLowerCase().includes("already")) {
    throw new Error(`createUser ${email}: ${error.message}`);
  }
  const { data: lista } = await service.auth.admin.listUsers();
  const existente = lista?.users.find((u) => u.email === email);
  if (!existente) throw new Error(`usuario ${email} existe pero no se encontró`);
  await service.auth.admin.updateUserById(existente.id, { password: PASSWORD, app_metadata });
  return existente.id;
}

async function entrar(email: string): Promise<Authed> {
  const c = nuevoCliente();
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return c;
}

beforeAll(async () => {
  service = makeTestSupabaseClient();
  await cleanupTestDb(service);
  userIds.push(await crearUsuario(EMAILS.admin, "admin"));
  userIds.push(await crearUsuario(EMAILS.vendedor, "vendedor"));
  admin = await entrar(EMAILS.admin);
  vendedor = await entrar(EMAILS.vendedor);
  anon = nuevoCliente();

  const leadId = crypto.randomUUID();
  const { error: leadErr } = await service.from("leads").insert({
    id: leadId,
    nombre: "Busquedas Fixture Lead",
    telefono: `+5${leadId.replace(/-/g, "").slice(0, 12)}`,
    canal_origen: "wa",
    meta_user_ids: {},
  });
  if (leadErr) throw new Error(`seed lead: ${leadErr.message}`);
  sessionId = crypto.randomUUID();
  const { error: sessErr } = await service
    .from("lead_session")
    .insert({ id: sessionId, lead_id: leadId, consulta: "busquedas fixture" });
  if (sessErr) throw new Error(`seed lead_session: ${sessErr.message}`);
}, 120_000);

beforeEach(async () => {
  const { error } = await service
    .from("tool_executions")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`cleanup tool_executions: ${error.message}`);
});

afterAll(async () => {
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await service.from("usuarios").delete().in("email", Object.values(EMAILS));
  await cleanupTestDb(service);
}, 120_000);

describe("SupabaseBusquedasSinResultadoRepository (integration)", () => {
  runBusquedasSinResultadoContract(async () => ({
    repo: new SupabaseBusquedasSinResultadoRepository(admin),
    async sembrar(llamadas) {
      const filas = llamadas.map((l) => ({
        lead_session_id: sessionId,
        tool_name: l.toolName ?? "buscar_repuesto",
        args: l.args as never,
        result: l.result as never,
        error: l.error ?? null,
        created_at: l.creadaEn.toISOString(),
      }));
      if (filas.length === 0) return;
      const { error } = await service.from("tool_executions").insert(filas);
      if (error) throw new Error(`seed tool_executions: ${error.message}`);
    },
  }));

  test("un vendedor no puede leer el reporte", async () => {
    const repo = new SupabaseBusquedasSinResultadoRepository(vendedor);
    await expect(repo.listar(new Date(Date.now() - 86_400_000), 10)).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  test("anon no puede ejecutar la función", async () => {
    const repo = new SupabaseBusquedasSinResultadoRepository(anon);
    await expect(repo.listar(new Date(Date.now() - 86_400_000), 10)).rejects.toThrow(
      PermissionDeniedError,
    );
  });
});
