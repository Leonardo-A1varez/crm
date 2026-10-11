import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/types.gen";
import { sembrarConversacion, sembrarLead, sembrarSesion } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

/**
 * Columnas `media_*` de `mensajes` + bucket privado `mensajes_media`
 * (migración 20261012120000). Lo que un unit test no ve: los CHECK, los tipos
 * que acepta el bucket y, sobre todo, quién puede leer y quién escribir.
 *
 * Sólo contra el stack local: `node scripts/con-stack-local.mjs --perfil test
 * --resembrar -- vitest run -c vitest.integration.config.ts
 * tests/integration/mensajes-media.supabase.test.ts`.
 */

type Authed = SupabaseClient<Database>;

const BUCKET = "mensajes_media";
const PASSWORD = "mensajes-media-test-2026!secret";
const EMAILS = {
  admin: "media-admin@crm.local",
  vendedor: "media-vendedor@crm.local",
} as const;

let service: TestClient;
let admin: Authed;
let vendedor: Authed;
let anon: Authed;
const userIds: string[] = [];
const subidos: string[] = [];

let sesionId: string;
let conversacionId: string;

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

const ruta = (ext = "png") => `sesiones/${sesionId}/${crypto.randomUUID()}.${ext}`;
const PNG_MINIMO = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44,
]);

async function subirComoServicio(path: string, tipo = "image/png") {
  const r = await service.storage.from(BUCKET).upload(path, PNG_MINIMO, { contentType: tipo });
  if (!r.error) subidos.push(path);
  return r;
}

async function insertarMensaje(media: Record<string, unknown>) {
  return service.from("mensajes").insert({
    conversacion_id: conversacionId,
    lead_session_id: sesionId,
    direction: "in",
    sender: "lead",
    tipo: "image",
    ...media,
  });
}

beforeAll(async () => {
  service = makeTestSupabaseClient();
  await cleanupTestDb(service);
  userIds.push(await crearUsuario(EMAILS.admin, "admin"));
  userIds.push(await crearUsuario(EMAILS.vendedor, "vendedor"));
  admin = await entrar(EMAILS.admin);
  vendedor = await entrar(EMAILS.vendedor);
  anon = nuevoCliente();

  const leadId = await sembrarLead(service, "media");
  sesionId = await sembrarSesion(service, leadId, "media");
  conversacionId = await sembrarConversacion(service, leadId);
}, 120_000);

afterAll(async () => {
  if (subidos.length > 0) await service.storage.from(BUCKET).remove(subidos);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await service.from("usuarios").delete().in("email", Object.values(EMAILS));
  await cleanupTestDb(service);
}, 120_000);

describe("mensajes.media_* (CHECK)", () => {
  test("una ruta con .. o fuera de sesiones/ no entra", async () => {
    for (const media_path of [
      "../secreto.png",
      `sesiones/${sesionId}/../otro.png`,
      "flujos/abc.png",
      `sesiones/${sesionId}/nombre-libre.png`,
    ]) {
      const { error } = await insertarMensaje({
        media_estado: "descargado",
        media_mime: "image/png",
        media_path,
      });
      expect(error?.code, media_path).toBe("23514");
    }
  });

  test("descargado sin ruta o sin tipo no entra", async () => {
    const sinRuta = await insertarMensaje({ media_estado: "descargado", media_mime: "image/png" });
    expect(sinRuta.error?.code).toBe("23514");
    const sinTipo = await insertarMensaje({ media_estado: "descargado", media_path: ruta() });
    expect(sinTipo.error?.code).toBe("23514");
  });

  test("un estado inventado o un tamaño negativo no entran", async () => {
    expect((await insertarMensaje({ media_estado: "listo" })).error?.code).toBe("23514");
    expect(
      (await insertarMensaje({ media_estado: "pendiente", media_bytes: -1 })).error?.code,
    ).toBe("23514");
  });

  test("pendiente sin ruta y descargado con ruta válida sí entran", async () => {
    expect(
      (await insertarMensaje({ media_estado: "pendiente", media_meta_id: "m1" })).error,
    ).toBeNull();
    expect(
      (
        await insertarMensaje({
          media_estado: "descargado",
          media_mime: "image/png",
          media_path: ruta(),
        })
      ).error,
    ).toBeNull();
  });
});

describe("bucket mensajes_media", () => {
  test("es privado y acepta 50 MiB y los tipos de WhatsApp (más octet-stream)", async () => {
    const { data, error } = await service.storage.getBucket(BUCKET);
    expect(error).toBeNull();
    expect(data?.public).toBe(false);
    expect(data?.file_size_limit).toBe(52428800);
    for (const tipo of [
      "image/jpeg",
      "image/webp",
      "audio/ogg",
      "audio/aac",
      "video/mp4",
      "video/3gpp",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/octet-stream",
    ]) {
      expect(data?.allowed_mime_types, tipo).toContain(tipo);
    }
    expect(data?.allowed_mime_types).not.toContain("text/html");
    expect(data?.allowed_mime_types).not.toContain("image/svg+xml");
  });

  test("el service role sube; text/html y svg se rechazan por tipo", async () => {
    expect((await subirComoServicio(ruta())).error).toBeNull();
    expect((await subirComoServicio(ruta("html"), "text/html")).error).not.toBeNull();
    expect((await subirComoServicio(ruta("svg"), "image/svg+xml")).error).not.toBeNull();
  });

  test("un vendedor y un admin leen con una URL firmada de pocos segundos", async () => {
    const path = ruta();
    expect((await subirComoServicio(path)).error).toBeNull();
    for (const cliente of [vendedor, admin]) {
      const { data, error } = await cliente.storage.from(BUCKET).createSignedUrl(path, 30);
      expect(error).toBeNull();
      const r = await fetch(data!.signedUrl);
      expect(r.status).toBe(200);
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG_MINIMO);
    }
  });

  test("sin sesión no se firma ni se lee, y el bucket no tiene URL pública", async () => {
    const path = ruta();
    expect((await subirComoServicio(path)).error).toBeNull();
    const firmada = await anon.storage.from(BUCKET).createSignedUrl(path, 30);
    expect(firmada.data).toBeNull();
    expect(firmada.error).not.toBeNull();

    const base = process.env["SUPABASE_TEST_URL"]!;
    const publica = await fetch(`${base}/storage/v1/object/public/${BUCKET}/${path}`);
    expect(publica.status).not.toBe(200);
    // Una URL firmada con el token adulterado tampoco abre el objeto.
    const buena = await vendedor.storage.from(BUCKET).createSignedUrl(path, 30);
    const rota = buena.data!.signedUrl.replace(/token=[^&]+/, "token=abc.def.ghi");
    expect((await fetch(rota)).status).not.toBe(200);
  });

  test("ni un vendedor ni un admin escriben, pisan o borran en sesiones/", async () => {
    const existente = ruta();
    expect((await subirComoServicio(existente)).error).toBeNull();
    for (const [nombre, cliente] of [
      ["vendedor", vendedor],
      ["admin", admin],
    ] as const) {
      const nuevo = await cliente.storage
        .from(BUCKET)
        .upload(ruta(), PNG_MINIMO, { contentType: "image/png" });
      expect(nuevo.error, `${nombre} sube`).not.toBeNull();

      const pisa = await cliente.storage
        .from(BUCKET)
        .upload(existente, new Uint8Array([1, 2, 3]), { contentType: "image/png", upsert: true });
      expect(pisa.error, `${nombre} pisa`).not.toBeNull();

      await cliente.storage.from(BUCKET).remove([existente]);
    }
    // Sigue ahí, intacto: la policy no dejó borrar.
    const { data } = await service.storage.from(BUCKET).download(existente);
    expect(new Uint8Array(await data!.arrayBuffer())).toEqual(PNG_MINIMO);
  });

  test("la excepción previa sigue en pie: un admin sube imágenes de flujos, un vendedor no", async () => {
    const path = `flujos/${crypto.randomUUID()}.png`;
    const v = await vendedor.storage
      .from(BUCKET)
      .upload(path, PNG_MINIMO, { contentType: "image/png" });
    expect(v.error).not.toBeNull();
    const a = await admin.storage
      .from(BUCKET)
      .upload(path, PNG_MINIMO, { contentType: "image/png" });
    expect(a.error).toBeNull();
    subidos.push(path);
  });
});
