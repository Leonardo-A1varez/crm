import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";
import type { Database } from "@/server/db/types.gen";

/**
 * Matriz RLS (spec Slice 3). Convenciones PostgREST:
 *  - SELECT denegado  → data [] (0 rows), SIN error.
 *  - INSERT denegado  → error code 42501 (RLS violation).
 *  - UPDATE denegado  → 0 rows afectadas, SIN error (trampa conocida).
 */

type AuthedClient = SupabaseClient<Database>;

const PASSWORD = "rls-test-2026!secret";
const EMAILS = {
  admin: "rls-admin-test@crm.local",
  vendedor: "rls-vendedor-test@crm.local",
  sinRol: "rls-sinrol-test@crm.local",
} as const;

let service: TestClient;
let admin: AuthedClient;
let vendedor: AuthedClient;
let sinRol: AuthedClient;
let anon: AuthedClient;
let leadId: string;
const userIds: string[] = [];

function anonClient(): AuthedClient {
  const url = process.env["SUPABASE_TEST_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !key) {
    throw new Error("RLS tests requieren SUPABASE_TEST_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function loginAs(email: string): Promise<AuthedClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login test user ${email}: ${error.message}`);
  return client;
}

beforeAll(async () => {
  service = makeTestSupabaseClient();
  await cleanupTestDb(service);

  for (const [key, email] of Object.entries(EMAILS)) {
    const appMetadata = key === "sinRol" ? {} : { rol: key === "admin" ? "admin" : "vendedor" };
    const { data: created, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: appMetadata,
    });
    if (!error) {
      userIds.push(created.user.id);
      continue;
    }
    // Corrida abortada previa dejó el usuario: reusar + re-asegurar metadata/password.
    if (!error.message.toLowerCase().includes("already")) {
      throw new Error(`createUser ${email}: ${error.message}`);
    }
    const { data: list, error: listErr } = await service.auth.admin.listUsers();
    if (listErr) throw new Error(`listUsers: ${listErr.message}`);
    const existing = list.users.find((u) => u.email === email);
    if (!existing) throw new Error(`usuario ${email} reportado como existente pero no encontrado`);
    const { error: updErr } = await service.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      app_metadata: appMetadata,
    });
    if (updErr) throw new Error(`updateUser ${email}: ${updErr.message}`);
    userIds.push(existing.id);
  }

  admin = await loginAs(EMAILS.admin);
  vendedor = await loginAs(EMAILS.vendedor);
  sinRol = await loginAs(EMAILS.sinRol);
  anon = anonClient();

  // Fixture mínima por service-role.
  const { data: lead, error: e } = await service
    .from("leads")
    .insert({
      nombre: "Lead RLS",
      telefono: "+595981000111",
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2020,
      canal_origen: "wa",
      meta_user_ids: {},
    })
    .select()
    .single();
  if (e) throw new Error(e.message);
  leadId = lead.id;

  const { error: e2 } = await service.from("productos").insert({
    codigo_interno: "RLS-TEST-1",
    nombre: "Producto RLS",
    compatibilidad: [],
    precio: 1000,
    stock: 5,
    activo: true,
  });
  if (e2) throw new Error(e2.message);

  const { error: e3 } = await service.from("admin_actions").insert({
    action: "rls-fixture",
    entity_type: "test",
    entity_id: leadId,
    payload: {},
  });
  if (e3) throw new Error(e3.message);
}, 120_000);

afterAll(async () => {
  for (const id of userIds) {
    await service.auth.admin.deleteUser(id);
  }
  await cleanupTestDb(service);
}, 120_000);

describe("RLS — vendedor", () => {
  test("SELECT leads permitido", async () => {
    const { data, error } = await vendedor.from("leads").select("id");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(1);
  });

  test("INSERT + UPDATE lead permitidos", async () => {
    const { data: created, error } = await vendedor
      .from("leads")
      .insert({
        nombre: "Lead Vendedor",
        telefono: "+595981000222",
        vehiculo_marca: "Kia",
        vehiculo_modelo: "Rio",
        vehiculo_anio: 2019,
        canal_origen: "wa",
        meta_user_ids: {},
      })
      .select()
      .single();
    expect(error).toBeNull();

    const { data: updated, error: e2 } = await vendedor
      .from("leads")
      .update({ nombre: "Lead Vendedor 2" })
      .eq("id", created!.id)
      .select();
    expect(e2).toBeNull();
    expect(updated).toHaveLength(1);
  });

  test("SELECT productos permitido, INSERT denegado (42501)", async () => {
    const { data, error } = await vendedor.from("productos").select("id");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(1);

    const { error: e2 } = await vendedor.from("productos").insert({
      codigo_interno: "RLS-DENY-1",
      nombre: "No debería",
      compatibilidad: [],
      precio: 1,
      stock: 0,
      activo: true,
    });
    expect(e2?.code).toBe("42501");
  });

  test("UPDATE productos denegado silencioso (0 rows)", async () => {
    const { data, error } = await vendedor
      .from("productos")
      .update({ precio: 9999 })
      .eq("codigo_interno", "RLS-TEST-1")
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  test("admin_actions invisible (0 rows)", async () => {
    const { data, error } = await vendedor.from("admin_actions").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  test("event_outbox deny-all (SELECT 0 rows, INSERT 42501)", async () => {
    const { data } = await vendedor.from("event_outbox").select("id");
    expect(data ?? []).toHaveLength(0);
    const { error } = await vendedor
      .from("event_outbox")
      .insert({ event_name: "x", event_data: {}, event_id: null });
    expect(error?.code).toBe("42501");
  });
});

describe("RLS — session_recordatorios (recordatorio de seguimiento)", () => {
  /**
   * Se cubren las tres operaciones que el panel ejecuta, y se fija que DELETE
   * NO tenga policy. Ese último caso es el que se escapó una vez en este repo
   * —`tags` sin policy de DELETE borraba 0 filas mientras la UI decía
   * "listo"—: acá el borrado silencioso es la conducta buscada, porque nada
   * borra recordatorios. Si alguien agrega un borrado real desde el panel, este
   * test se cae y le recuerda que le falta la policy.
   */
  // Lead nuevo por sesión: `lead_session_unique_activa_idx` no deja dos
  // sesiones abiertas para el mismo lead.
  async function sesionDePrueba(): Promise<string> {
    const sufijo = crypto.randomUUID().replace(/-/g, "").slice(0, 9);
    const { data: lead, error: leadError } = await service
      .from("leads")
      .insert({
        nombre: "Lead RLS recordatorio",
        telefono: `+5959${sufijo}`,
        vehiculo_marca: "Toyota",
        vehiculo_modelo: "Hilux",
        vehiculo_anio: 2019,
        canal_origen: "wa",
        meta_user_ids: {},
      })
      .select()
      .single();
    if (leadError) throw new Error(leadError.message);

    const { data, error } = await service
      .from("lead_session")
      .insert({
        lead_id: lead.id,
        current_stage: "negociando",
        urgencia: "media",
        consulta: "rls recordatorios",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  test("vendedor: INSERT, SELECT y UPDATE permitidos", async () => {
    const sessionId = await sesionDePrueba();

    const { data: creado, error } = await vendedor
      .from("session_recordatorios")
      .insert({
        lead_session_id: sessionId,
        recordar_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        nota: "volver en 2 días",
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(creado?.estado).toBe("pendiente");

    const { data: leidos, error: e2 } = await vendedor
      .from("session_recordatorios")
      .select("id")
      .eq("id", creado!.id);
    expect(e2).toBeNull();
    expect(leidos).toHaveLength(1);

    // Cancelar es un UPDATE, no un DELETE: es la operación que la UI ejecuta.
    const { data: cancelados, error: e3 } = await vendedor
      .from("session_recordatorios")
      .update({
        estado: "cancelado",
        motivo_cancelacion: "manual",
        cancelado_at: new Date().toISOString(),
      })
      .eq("id", creado!.id)
      .select();
    expect(e3).toBeNull();
    expect(cancelados).toHaveLength(1);
  });

  test("DELETE sin policy: 0 filas y ningún caller lo usa", async () => {
    const sessionId = await sesionDePrueba();
    const { data: creado } = await service
      .from("session_recordatorios")
      .insert({
        lead_session_id: sessionId,
        recordar_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        nota: "",
      })
      .select()
      .single();

    const { data: borrados, error } = await vendedor
      .from("session_recordatorios")
      .delete()
      .eq("id", creado!.id)
      .select();
    expect(error).toBeNull();
    expect(borrados).toHaveLength(0);

    // Y sigue ahí: el borrado silencioso no se llevó nada por delante.
    const { data: sigue } = await service
      .from("session_recordatorios")
      .select("id")
      .eq("id", creado!.id);
    expect(sigue).toHaveLength(1);
  });

  test("authenticated sin rol: no ve ni escribe recordatorios", async () => {
    const { data, error } = await sinRol.from("session_recordatorios").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const sessionId = await sesionDePrueba();
    const { error: e2 } = await sinRol.from("session_recordatorios").insert({
      lead_session_id: sessionId,
      recordar_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      nota: "",
    });
    expect(e2?.code).toBe("42501");
  });
});

describe("RLS — admin", () => {
  test("INSERT + UPDATE productos permitidos", async () => {
    const { error } = await admin.from("productos").insert({
      codigo_interno: "RLS-ADMIN-1",
      nombre: "Producto Admin",
      compatibilidad: [],
      precio: 500,
      stock: 2,
      activo: true,
    });
    expect(error).toBeNull();

    const { data, error: e2 } = await admin
      .from("productos")
      .update({ precio: 750 })
      .eq("codigo_interno", "RLS-ADMIN-1")
      .select();
    expect(e2).toBeNull();
    expect(data).toHaveLength(1);
  });

  test("admin_actions visible", async () => {
    const { data, error } = await admin.from("admin_actions").select("id");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(1);
  });
});

describe("RLS — fail-closed", () => {
  test("anon: SELECT leads vacío", async () => {
    const { data } = await anon.from("leads").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  test("authenticated sin rol: SELECT leads vacío (fail-closed)", async () => {
    const { data, error } = await sinRol.from("leads").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  test("authenticated sin rol: INSERT lead denegado (42501)", async () => {
    const { error } = await sinRol.from("leads").insert({
      nombre: "No entra",
      telefono: "+595981000333",
      vehiculo_marca: "X",
      vehiculo_modelo: "Y",
      vehiculo_anio: 2020,
      canal_origen: "wa",
      meta_user_ids: {},
    });
    expect(error?.code).toBe("42501");
  });
});
