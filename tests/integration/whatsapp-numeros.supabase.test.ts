import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PermissionDeniedError } from "@/lib/errors";
import { cifrarToken, descifrarToken, llaveroDesdeEnv } from "@/lib/meta/token-cifrado";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseWhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.supabase.repo";
import type { Database } from "@/server/db/types.gen";
import { sembrarConversacion, sembrarLead } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

/**
 * `whatsapp_numeros` + `whatsapp_numeros_credenciales` + el RPC de alta
 * (migración 20261011120000). Lo que se prueba es lo que un unit test no ve:
 * la RLS, los grants y que el token no salga por REST para nadie del panel.
 *
 * Sólo contra el stack local: `node scripts/con-stack-local.mjs --perfil test
 * --resembrar -- vitest run -c vitest.integration.config.ts
 * tests/integration/whatsapp-numeros.supabase.test.ts`.
 */

type Authed = SupabaseClient<Database>;

const PASSWORD = "whatsapp-numeros-test-2026!secret";
const EMAILS = {
  admin: "wa-numeros-admin@crm.local",
  vendedor: "wa-numeros-vendedor@crm.local",
} as const;
const WABA = "102290129340398";
const PHONE = "106540352242922";

let service: TestClient;
let admin: Authed;
let vendedor: Authed;
let anon: Authed;
const userIds: string[] = [];
const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: randomBytes(32).toString("base64") });

function nuevoCliente(): Authed {
  const url = process.env["SUPABASE_TEST_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !key) throw new Error("requiere SUPABASE_TEST_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function crearUsuario(email: string, rol: "admin" | "vendedor"): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { rol },
  });
  if (!error) return data.user.id;
  const { data: lista } = await service.auth.admin.listUsers();
  const existente = lista?.users.find((u) => u.email === email);
  if (!existente) throw new Error(`createUser ${email}: ${error.message}`);
  await service.auth.admin.updateUserById(existente.id, {
    password: PASSWORD,
    app_metadata: { rol },
  });
  return existente.id;
}

async function entrar(email: string): Promise<Authed> {
  const c = nuevoCliente();
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return c;
}

async function borrarNumeros() {
  await service.from("whatsapp_numeros").delete().neq("phone_number_id", "0");
}

function alta(token = "EAAG-token-de-negocio") {
  return {
    waba_id: WABA,
    phone_number_id: PHONE,
    display_phone_number: "+1 555-078-3881",
    verified_name: "Lucky Shrub",
    modo: "coexistencia" as const,
    token_cifrado: cifrarToken(token, PHONE, llavero),
  };
}

beforeAll(async () => {
  service = makeTestSupabaseClient();
  await cleanupTestDb(service);
  await borrarNumeros();
  userIds.push(await crearUsuario(EMAILS.admin, "admin"));
  userIds.push(await crearUsuario(EMAILS.vendedor, "vendedor"));
  admin = await entrar(EMAILS.admin);
  vendedor = await entrar(EMAILS.vendedor);
  anon = nuevoCliente();
}, 120_000);

afterAll(async () => {
  await borrarNumeros();
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await service.from("usuarios").delete().in("email", Object.values(EMAILS));
  await cleanupTestDb(service);
}, 120_000);

describe("whatsapp_numero_conectar (RPC)", () => {
  test("el admin conecta: queda la fila con su uid y el token cifrado (no en claro)", async () => {
    await borrarNumeros();
    const r = await new SupabaseWhatsAppNumerosRepository(admin).conectar(alta());
    expect(r.id).toMatch(/[0-9a-f-]{36}/);

    const { data: fila } = await service
      .from("whatsapp_numeros")
      .select("modo, estado, conectado_por, historial_estado")
      .eq("phone_number_id", PHONE)
      .single();
    expect(fila).toEqual({
      modo: "coexistencia",
      estado: "conectado",
      conectado_por: userIds[0],
      historial_estado: "pendiente",
    });

    const { data: cred } = await service
      .from("whatsapp_numeros_credenciales")
      .select("token_cifrado")
      .eq("phone_number_id", PHONE)
      .single();
    expect(cred?.token_cifrado).not.toContain("EAAG");
    expect(descifrarToken(cred!.token_cifrado, PHONE, llavero)).toBe("EAAG-token-de-negocio");
  });

  test("vendedor y anon no pueden conectar (42501)", async () => {
    await expect(
      new SupabaseWhatsAppNumerosRepository(vendedor).conectar(alta()),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    const { error } = await anon.rpc("whatsapp_numero_conectar", {
      p_waba_id: WABA,
      p_phone_number_id: PHONE,
      p_display_phone_number: "",
      p_verified_name: "",
      p_modo: "coexistencia",
      p_token_cifrado: alta().token_cifrado,
    });
    expect(error?.code).toBe("42501");
  });

  test("un token que no tiene la forma del cifrado se rechaza (check de la tabla)", async () => {
    const { error } = await admin.rpc("whatsapp_numero_conectar", {
      p_waba_id: WABA,
      p_phone_number_id: PHONE,
      p_display_phone_number: "",
      p_verified_name: "",
      p_modo: "coexistencia",
      p_token_cifrado: "EAAG-en-claro",
    });
    expect(error?.code).toBe("23514");
  });

  test("reconectar arranca de cero la sincronización y reemplaza el token", async () => {
    await borrarNumeros();
    const repoAdmin = new SupabaseWhatsAppNumerosRepository(admin);
    const repoBackend = new SupabaseWhatsAppNumerosRepository(service);
    await repoAdmin.conectar(alta("token-viejo-123456"));
    expect(await repoBackend.reservarSincronizacion(PHONE, "contactos")).toBe(true);
    await repoBackend.actualizarHistorial(PHONE, { estado: "rechazado" });

    await repoAdmin.conectar(alta("token-nuevo-123456"));
    const fila = await repoBackend.buscar(PHONE);
    expect(fila?.contactos_pedido_at).toBeNull();
    expect(fila?.historial_estado).toBe("pendiente");
    const cifrado = await repoBackend.tokenCifrado(PHONE);
    expect(descifrarToken(cifrado!, PHONE, llavero)).toBe("token-nuevo-123456");
  });
});

describe("RLS — el token no sale por REST para nadie del panel", () => {
  test("admin lee whatsapp_numeros; vendedor no ve filas; anon sin permiso", async () => {
    await borrarNumeros();
    await new SupabaseWhatsAppNumerosRepository(admin).conectar(alta());

    expect(await new SupabaseWhatsAppNumerosRepository(admin).listar()).toHaveLength(1);
    const { data: delVendedor } = await vendedor.from("whatsapp_numeros").select("id");
    expect(delVendedor ?? []).toHaveLength(0);
    const { error: deAnon } = await anon.from("whatsapp_numeros").select("id");
    expect(deAnon?.code).toBe("42501");
  });

  for (const [rol, quien] of [
    ["admin", () => admin],
    ["vendedor", () => vendedor],
    ["anon", () => anon],
  ] as const) {
    test(`${rol}: whatsapp_numeros_credenciales está cerrada (42501), también por embed`, async () => {
      const directo = await quien().from("whatsapp_numeros_credenciales").select("token_cifrado");
      expect(directo.error?.code).toBe("42501");
      expect(directo.data).toBeNull();

      const embebido = await quien()
        .from("whatsapp_numeros")
        .select("phone_number_id, whatsapp_numeros_credenciales(token_cifrado)");
      // O no hay permiso, o no trae el token: nunca el cifrado.
      expect(JSON.stringify(embebido.data ?? [])).not.toMatch(/v1\.[0-9a-f]{8}\./);
      if (rol !== "vendedor") expect(embebido.error).not.toBeNull();
    });

    test(`${rol}: no escribe whatsapp_numeros directo (sólo por el RPC)`, async () => {
      const ins = await quien().from("whatsapp_numeros").insert({
        waba_id: WABA,
        phone_number_id: "999",
        modo: "cloud",
      });
      expect(ins.error?.code).toBe("42501");
      const upd = await quien()
        .from("whatsapp_numeros")
        .update({ estado: "desconectado" })
        .eq("phone_number_id", PHONE);
      expect(upd.error?.code).toBe("42501");
      const del = await quien().from("whatsapp_numeros").delete().eq("phone_number_id", PHONE);
      expect(del.error?.code).toBe("42501");
    });
  }
});

describe("backend (service role)", () => {
  test("la reserva de una sincronización la toma uno solo", async () => {
    await borrarNumeros();
    await new SupabaseWhatsAppNumerosRepository(admin).conectar(alta());
    const repo = new SupabaseWhatsAppNumerosRepository(service);
    const [a, b] = await Promise.all([
      repo.reservarSincronizacion(PHONE, "historial"),
      repo.reservarSincronizacion(PHONE, "historial"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    await repo.confirmarSincronizacion(PHONE, "historial", "req-1");
    expect((await repo.buscar(PHONE))?.historial_estado).toBe("pedido");
  });

  test("un estado final del historial no se pisa con un lote tardío", async () => {
    const repo = new SupabaseWhatsAppNumerosRepository(service);
    await repo.actualizarHistorial(PHONE, { estado: "completo", progreso: 100 });
    await repo.actualizarHistorial(PHONE, { estado: "en_curso", progreso: 40 });
    const fila = await repo.buscar(PHONE);
    expect(fila).toMatchObject({ historial_estado: "completo", historial_progreso: 100 });
  });

  test("tokenCifrado sólo con el número conectado", async () => {
    const repo = new SupabaseWhatsAppNumerosRepository(service);
    expect(await repo.tokenCifrado(PHONE)).not.toBeNull();
    await service
      .from("whatsapp_numeros")
      .update({ estado: "desconectado" })
      .eq("phone_number_id", PHONE);
    expect(await repo.tokenCifrado(PHONE)).toBeNull();
  });
});

describe("conversaciones.whatsapp_phone_number_id lo escribe sólo el backend", () => {
  test("el panel (admin o vendedor) no la cambia; el pipeline sí", async () => {
    const lead = await sembrarLead(service, "wa-numero");
    const conv = await sembrarConversacion(service, lead);

    for (const cliente of [admin, vendedor]) {
      const { error } = await cliente
        .from("conversaciones")
        .update({ whatsapp_phone_number_id: PHONE })
        .eq("id", conv);
      expect(error?.code).toBe("42501");
    }
    // Lo demás del panel sigue andando sobre la misma fila.
    const { error: modo } = await vendedor
      .from("conversaciones")
      .update({ modo_respuesta_override: "copiloto" })
      .eq("id", conv);
    expect(modo).toBeNull();

    const actualizada = await new SupabaseConversationsRepository(service).update(conv, {
      whatsapp_phone_number_id: PHONE,
    });
    expect(actualizada.whatsapp_phone_number_id).toBe(PHONE);
  });
});
