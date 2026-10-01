import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SupabaseBorradoresIaRepository } from "@/server/repositories/borradores-ia.supabase.repo";
import type { Database } from "@/server/db/types.gen";
import { sembrarCadena } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

type Authed = SupabaseClient<Database>;
type BorradorUpdate = Database["public"]["Tables"]["borradores_ia"]["Update"];

const PASSWORD = "copiloto-rls-test-2026!secret";
const EMAILS = {
  admin: "copiloto-rls-admin@crm.local",
  vendedor: "copiloto-rls-vendedor@crm.local",
  sinRol: "copiloto-rls-sinrol@crm.local",
} as const;

let service: TestClient;
let admin: Authed;
let vendedor: Authed;
let sinRol: Authed;
let anon: Authed;
let vendedorId: string;
const userIds: string[] = [];

function nuevoCliente(): Authed {
  const url = process.env["SUPABASE_TEST_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !key)
    throw new Error("RLS tests requieren SUPABASE_TEST_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function crearUsuario(email: string, rol: "admin" | "vendedor" | null): Promise<string> {
  const app_metadata = rol === null ? {} : { rol };
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata,
  });
  if (!error) return data.user.id;
  if (!error.message.toLowerCase().includes("already"))
    throw new Error(`createUser ${email}: ${error.message}`);
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
  vendedorId = await crearUsuario(EMAILS.vendedor, "vendedor");
  userIds.push(vendedorId);
  userIds.push(await crearUsuario(EMAILS.sinRol, null));
  admin = await entrar(EMAILS.admin);
  vendedor = await entrar(EMAILS.vendedor);
  sinRol = await entrar(EMAILS.sinRol);
  anon = nuevoCliente();
}, 120_000);

afterAll(async () => {
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await service.from("usuarios").delete().in("email", Object.values(EMAILS));
  await cleanupTestDb(service);
}, 120_000);

/** Un borrador `listo` escrito como lo escribe el pipeline: con service-role. */
async function borradorListo() {
  const cadena = await sembrarCadena(service, "copiloto-rls");
  const repo = new SupabaseBorradoresIaRepository(service);
  const r = await repo.iniciar({
    conversacionId: cadena.conversacionId,
    leadSessionId: cadena.sesionId,
    mensajeOrigenId: cadena.mensajeId,
  });
  if (r.resultado !== "creado") throw new Error("fixture: se esperaba 'creado'");
  await repo.completar(r.borradorId, {
    contenido: "Texto del borrador",
    origen: "ia",
    reglaId: null,
  });
  return { ...cadena, borradorId: r.borradorId };
}

describe("RLS — borradores_ia", () => {
  test("admin y vendedor leen; sin rol y anon no ven nada", async () => {
    const { borradorId } = await borradorListo();

    for (const cliente of [admin, vendedor]) {
      const { data, error } = await cliente.from("borradores_ia").select("id").eq("id", borradorId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
    for (const cliente of [sinRol, anon]) {
      const { data } = await cliente.from("borradores_ia").select("id").eq("id", borradorId);
      expect(data ?? []).toHaveLength(0);
    }
  });

  test("nadie del panel inserta: sin policy de INSERT (42501)", async () => {
    const cadena = await sembrarCadena(service, "copiloto-rls-ins");
    const { error } = await vendedor.from("borradores_ia").insert({
      conversacion_id: cadena.conversacionId,
      lead_session_id: cadena.sesionId,
      mensaje_origen_id: cadena.mensajeId,
      estado: "redactando",
    });
    expect(error?.code).toBe("42501");
  });

  test("el vendedor marca usado un borrador listo (y solo las columnas del uso)", async () => {
    const { borradorId } = await borradorListo();

    const { data, error } = await vendedor
      .from("borradores_ia")
      .update({
        estado: "usado",
        usado_via: "copiar",
        usado_por: vendedorId,
        usado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", borradorId)
      .eq("estado", "listo")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    // Segundo intento: el USING exige `listo`, así que afecta 0 filas sin error.
    const { data: otra, error: e2 } = await vendedor
      .from("borradores_ia")
      .update({ estado: "usado", usado_via: "insertar", usado_at: new Date().toISOString() })
      .eq("id", borradorId)
      .select("id");
    expect(e2).toBeNull();
    expect(otra).toHaveLength(0);
  });

  test("el repo con el cliente del vendedor: marcarUsado funciona una sola vez", async () => {
    const { borradorId } = await borradorListo();
    const repo = new SupabaseBorradoresIaRepository(vendedor);

    expect(await repo.marcarUsado(borradorId, { via: "copiar", usuarioId: vendedorId })).toBe(
      "marcado",
    );
    expect(await repo.marcarUsado(borradorId, { via: "insertar", usuarioId: vendedorId })).toBe(
      "ya_usado",
    );
  });

  test("el vendedor NO puede editar el texto ni pasar a otro estado que 'usado'", async () => {
    const { borradorId } = await borradorListo();

    const texto = await vendedor
      .from("borradores_ia")
      .update({ contenido: "manipulado" })
      .eq("id", borradorId);
    expect(texto.error?.code).toBe("42501");

    const descartar = await vendedor
      .from("borradores_ia")
      .update({ estado: "descartado", updated_at: new Date().toISOString() })
      .eq("id", borradorId);
    expect(descartar.error?.code).toBe("42501");

    // Nada de eso tocó la fila.
    const { data } = await service
      .from("borradores_ia")
      .select("estado, contenido")
      .eq("id", borradorId)
      .single();
    expect(data).toEqual({ estado: "listo", contenido: "Texto del borrador" });
  });

  test("nadie del panel borra ni vacía la tabla", async () => {
    const { borradorId } = await borradorListo();
    const { error } = await vendedor.from("borradores_ia").delete().eq("id", borradorId);
    expect(error?.code).toBe("42501");

    const { count } = await service
      .from("borradores_ia")
      .select("id", { count: "exact", head: true })
      .eq("id", borradorId);
    expect(count).toBe(1);
  });

  test("el RPC iniciar_borrador_ia está cerrado al panel", async () => {
    const cadena = await sembrarCadena(service, "copiloto-rls-rpc");
    const { error } = await vendedor.rpc("iniciar_borrador_ia", {
      p_conversacion_id: cadena.conversacionId,
      p_lead_session_id: cadena.sesionId,
      p_mensaje_origen_id: cadena.mensajeId,
      p_forzar: false,
    });
    expect(error?.code).toBe("42501");
  });
});

describe("RLS — borradores_ia: el GRANT por columna, aislado del WITH CHECK", () => {
  // Cada caso lleva `estado: 'usado'` (y las columnas del uso), o sea que la
  // policy `borradores_ia_update_uso` lo dejaría pasar: lo único que lo frena es
  // que la columna extra no está en el `grant update (...)`. Si alguien amplía
  // el grant, estos tests fallan; el de `contenido` solo, sin `estado`, no.
  const NO_CONCEDIDAS: Record<string, unknown> = {
    contenido: "manipulado",
    origen: "regla",
    regla_id: null,
    error_codigo: "llm_error",
    mensaje_origen_id: "00000000-0000-0000-0000-000000000001",
    conversacion_id: "00000000-0000-0000-0000-000000000002",
    lead_session_id: "00000000-0000-0000-0000-000000000003",
    created_at: "2020-01-01T00:00:00Z",
  };

  for (const [rol, quien] of [
    ["vendedor", () => vendedor],
    ["admin", () => admin],
  ] as const) {
    for (const [columna, valor] of Object.entries(NO_CONCEDIDAS)) {
      test(`${rol}: 'usado' + ${columna} lo frena el GRANT (42501) y la fila queda intacta`, async () => {
        const { borradorId } = await borradorListo();

        const { error } = await quien()
          .from("borradores_ia")
          .update({
            estado: "usado",
            usado_via: "copiar",
            usado_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            [columna]: valor,
          } as BorradorUpdate)
          .eq("id", borradorId)
          .eq("estado", "listo");
        expect(error?.code).toBe("42501");

        const { data } = await service
          .from("borradores_ia")
          .select("estado, contenido, origen, usado_via")
          .eq("id", borradorId)
          .single();
        expect(data).toEqual({
          estado: "listo",
          contenido: "Texto del borrador",
          origen: "ia",
          usado_via: null,
        });
      });
    }
  }
});

describe("RLS — borradores_ia: matriz de escrituras por rol", () => {
  test("admin marca usado por la rama is_admin() y un segundo intento afecta 0 filas", async () => {
    const { borradorId } = await borradorListo();

    const { data, error } = await admin
      .from("borradores_ia")
      .update({
        estado: "usado",
        usado_via: "insertar",
        usado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", borradorId)
      .eq("estado", "listo")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: otra, error: e2 } = await admin
      .from("borradores_ia")
      .update({ estado: "usado", usado_via: "copiar", usado_at: new Date().toISOString() })
      .eq("id", borradorId)
      .select("id");
    expect(e2).toBeNull();
    expect(otra).toHaveLength(0);
  });

  test("el repo con el cliente del admin: marcarUsado funciona una sola vez", async () => {
    const { borradorId } = await borradorListo();
    const repo = new SupabaseBorradoresIaRepository(admin);

    expect(await repo.marcarUsado(borradorId, { via: "abrir_web", usuarioId: null })).toBe(
      "marcado",
    );
    expect(await repo.marcarUsado(borradorId, { via: "copiar", usuarioId: null })).toBe("ya_usado");
  });

  test("el admin no puede pasar a otro estado que 'usado' (WITH CHECK, 42501)", async () => {
    const { borradorId } = await borradorListo();
    const { error } = await admin
      .from("borradores_ia")
      .update({ estado: "descartado", updated_at: new Date().toISOString() })
      .eq("id", borradorId);
    expect(error?.code).toBe("42501");
  });

  for (const [rol, quien] of [
    ["admin", () => admin],
    ["vendedor", () => vendedor],
    ["sin rol", () => sinRol],
    ["anon", () => anon],
  ] as const) {
    test(`${rol}: INSERT, DELETE y TRUNCATE-por-DELETE denegados (42501) y el RPC cerrado`, async () => {
      const { borradorId, conversacionId, sesionId, mensajeId } = await borradorListo();
      const cliente = quien();

      const ins = await cliente.from("borradores_ia").insert({
        conversacion_id: conversacionId,
        lead_session_id: sesionId,
        mensaje_origen_id: mensajeId,
        estado: "descartado",
      });
      expect(ins.error?.code).toBe("42501");

      const del = await cliente.from("borradores_ia").delete().eq("id", borradorId);
      expect(del.error?.code).toBe("42501");

      const rpc = await cliente.rpc("iniciar_borrador_ia", {
        p_conversacion_id: conversacionId,
        p_lead_session_id: sesionId,
        p_mensaje_origen_id: mensajeId,
        p_forzar: true,
      });
      expect(rpc.error?.code).toBe("42501");

      // Ni el insert ni el RPC con forzar dejaron rastro: sigue el borrador original.
      const { data } = await service
        .from("borradores_ia")
        .select("id, estado")
        .eq("conversacion_id", conversacionId);
      expect(data).toEqual([{ id: borradorId, estado: "listo" }]);
    });
  }

  test("sin rol: UPDATE a 'usado' afecta 0 filas (la policy exige admin o vendedor)", async () => {
    const { borradorId } = await borradorListo();

    const { data, error } = await sinRol
      .from("borradores_ia")
      .update({
        estado: "usado",
        usado_via: "copiar",
        usado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", borradorId)
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);

    const { data: fila } = await service
      .from("borradores_ia")
      .select("estado")
      .eq("id", borradorId)
      .single();
    expect(fila?.estado).toBe("listo");
  });

  test("anon: UPDATE denegado por permiso de tabla (42501) y la fila queda intacta", async () => {
    const { borradorId } = await borradorListo();

    const { error } = await anon
      .from("borradores_ia")
      .update({
        estado: "usado",
        usado_via: "copiar",
        usado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", borradorId);
    expect(error?.code).toBe("42501");

    const { data: fila } = await service
      .from("borradores_ia")
      .select("estado")
      .eq("id", borradorId)
      .single();
    expect(fila?.estado).toBe("listo");
  });
});

describe("RLS — conversaciones.modo_respuesta_override", () => {
  test("admin y vendedor cambian el modo; sin rol no afecta ninguna fila", async () => {
    const { conversacionId } = await sembrarCadena(service, "copiloto-rls-modo");

    for (const cliente of [admin, vendedor]) {
      const { data, error } = await cliente
        .from("conversaciones")
        .update({ modo_respuesta_override: "copiloto" })
        .eq("id", conversacionId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }

    const { data: sinPermiso } = await sinRol
      .from("conversaciones")
      .update({ modo_respuesta_override: "automatico" })
      .eq("id", conversacionId)
      .select("id");
    expect(sinPermiso ?? []).toHaveLength(0);

    const { data: fila } = await service
      .from("conversaciones")
      .select("modo_respuesta_override")
      .eq("id", conversacionId)
      .single();
    expect(fila?.modo_respuesta_override).toBe("copiloto");
  });
});
