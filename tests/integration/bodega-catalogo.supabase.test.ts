import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/types.gen";
import { SupabaseBodegaCatalogoRepository } from "@/server/repositories/bodega-catalogo.supabase.repo";
import { runBodegaCatalogoContract } from "../repositories/bodega-catalogo.contract";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

// La copia del catálogo de Bodega Web contra Postgres real: el contrato del repo, la
// atomicidad de `bodega_aplicar_pagina` (filas + cursor en una transacción), la
// validación de filas y los permisos de las tablas nuevas.

type Authed = SupabaseClient<Database>;

const PASSWORD = "bodega-catalogo-2026!secret";
const EMAILS = {
  admin: "bodega-admin@crm.local",
  vendedor: "bodega-vendedor@crm.local",
} as const;

let service: TestClient;
let admin: Authed;
let vendedor: Authed;
let anon: Authed;
const userIds: string[] = [];

function nuevoCliente(): Authed {
  const url = process.env["SUPABASE_TEST_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !key) {
    throw new Error("Estos tests requieren SUPABASE_TEST_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
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
  if (!error.message.toLowerCase().includes("already")) {
    throw new Error(`createUser ${email}: ${error.message}`);
  }
  const { data: lista } = await service.auth.admin.listUsers();
  const existente = lista?.users.find((u) => u.email === email);
  if (!existente) throw new Error(`usuario ${email} existe pero no se encontró`);
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

async function limpiar(): Promise<void> {
  const resultados = [
    await service
      .from("bodega_variantes")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000"),
    await service.from("bodega_existencias").delete().neq("no_item", ""),
    await service.from("bodega_sync_cursor").delete().neq("tabla", ""),
    await service.from("catalogo_marcas").delete().neq("nombre", ""),
  ];
  for (const { error } of resultados) {
    if (error) throw new Error(`limpiar: ${error.message}`);
  }
}

beforeAll(async () => {
  service = makeTestSupabaseClient();
  await cleanupTestDb(service);
  userIds.push(await crearUsuario(EMAILS.admin, "admin"));
  userIds.push(await crearUsuario(EMAILS.vendedor, "vendedor"));
  admin = await entrar(EMAILS.admin);
  vendedor = await entrar(EMAILS.vendedor);
  anon = nuevoCliente();
});

beforeEach(limpiar);

afterAll(async () => {
  await limpiar();
  await cleanupTestDb(service);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
});

// ---------------------------------------------------------------------------
// El contrato del repo, contra la función SQL real
// ---------------------------------------------------------------------------
runBodegaCatalogoContract(async () => {
  await limpiar();
  return {
    repo: new SupabaseBodegaCatalogoRepository(service),
    marca: async (nombre) => {
      const { data, error } = await service
        .from("catalogo_marcas")
        .select("nombre, tipo, procedencia, activa, alias")
        .eq("nombre", nombre)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? undefined;
    },
    existencia: async (noItem) => {
      const { data, error } = await service
        .from("bodega_existencias")
        .select("activa, grupo_numero, origen")
        .eq("no_item", noItem)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? undefined;
    },
    variante: async (id) => {
      const { data, error } = await service
        .from("bodega_variantes")
        .select("activa, estado, descartada")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? undefined;
    },
    sembrarMarcaDelErp: async (m) => {
      const { error } = await service
        .from("catalogo_marcas")
        .insert({ ...m, activa: true, alias: [] });
      if (error) throw new Error(error.message);
    },
  };
});

// ---------------------------------------------------------------------------
// Atomicidad y validación
// ---------------------------------------------------------------------------
const CURSOR = { desde: "2026-10-07T15:04:05.123456Z", despues: "10234" };
const T = "2026-10-07T10:00:00.000001+00:00";
const buena = { no_item: "OK-1", grupo_numero: 100, origen: "excel", actualizado_en: T };

const aplicar = (tabla: string, filas: unknown, cursor: unknown = CURSOR) =>
  service.rpc("bodega_aplicar_pagina", {
    p_tabla: tabla,
    p_filas: filas as never,
    p_cursor: cursor as never,
  });

async function contar(tabla: "bodega_existencias" | "bodega_sync_cursor"): Promise<number> {
  const { count, error } = await service.from(tabla).select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

describe("bodega_aplicar_pagina: todo o nada", () => {
  test("una fila mala rechaza la página entera: ni filas ni cursor", async () => {
    const r = await aplicar("existencias", [buena, { ...buena, no_item: "  " }]);
    expect(r.error?.code).toBe("22023");
    expect(r.error?.message).toMatch(/^fila 2:/);
    expect(await contar("bodega_existencias")).toBe(0);
    expect(await contar("bodega_sync_cursor")).toBe(0);
  });

  test("las filas y el cursor entran juntos", async () => {
    const r = await aplicar("existencias", [buena]);
    expect(r.error).toBeNull();
    expect(r.data).toBe(1);
    expect(await contar("bodega_existencias")).toBe(1);
    const { data } = await service.from("bodega_sync_cursor").select().eq("tabla", "existencias");
    expect(data?.[0]).toMatchObject({ desde: CURSOR.desde, despues: CURSOR.despues });
  });

  test("si el cursor es inválido tampoco se escriben las filas", async () => {
    for (const cursor of [
      { desde: "ayer", despues: null },
      { desde: 5, despues: null },
      { despues: "x" },
      { desde: CURSOR.desde, despues: 7 },
      "texto",
    ]) {
      const r = await aplicar("existencias", [buena], cursor);
      expect(r.error?.code).toBe("22023");
    }
    expect(await contar("bodega_existencias")).toBe(0);
    expect(await contar("bodega_sync_cursor")).toBe(0);
  });

  test("el cursor de una tabla no pisa el de otra", async () => {
    await aplicar("existencias", [buena], CURSOR);
    await aplicar("marcas", [], { desde: "-infinity", despues: null });
    const c = await new SupabaseBodegaCatalogoRepository(service).leerCursores();
    expect(c.existencias).toEqual(CURSOR);
    expect(c.marcas).toEqual({ desde: "-infinity", despues: null });
  });

  test("tabla no permitida, p_filas que no es arreglo o más de 5000 filas → 22023", async () => {
    expect((await aplicar("usuarios", [])).error?.code).toBe("22023");
    expect((await aplicar("existencias", { no_item: "x" })).error?.code).toBe("22023");
    const muchas = Array.from({ length: 5001 }, (_, i) => ({ ...buena, no_item: `M${i}` }));
    expect((await aplicar("existencias", muchas)).error?.code).toBe("22023");
  });

  test("una variante con lado o estado inválido rechaza la página", async () => {
    const v = {
      id: "00000000-0000-4000-8000-000000000001",
      item_codigo_interno: "C-1",
      proveedor: null,
      estado: "CONFIRMED",
      descartada: false,
      promovida: false,
      actualizado_en: T,
    };
    expect((await aplicar("variantes", [{ ...v, lado: "ARRIBA" }])).error?.code).toBe("22023");
    expect((await aplicar("variantes", [{ ...v, estado: "" }])).error?.code).toBe("22023");
    expect((await aplicar("variantes", [{ ...v, id: "no-es-uuid" }])).error?.code).toBe("22023");
    expect((await aplicar("variantes", [{ ...v, descartada: "no" }])).error?.code).toBe("22023");
    // La marca llega al texto que cotiza el agente: tope de 100 y 50 caracteres.
    expect(
      (await aplicar("variantes", [{ ...v, marca_canonica: "M".repeat(101) }])).error?.code,
    ).toBe("22023");
    expect(
      (await aplicar("variantes", [{ ...v, marca_procedencia: "P".repeat(51) }])).error?.code,
    ).toBe("22023");
    expect((await aplicar("variantes", [v])).error).toBeNull();
  });

  test("una baja de variantes con clave que no es uuid rechaza la página", async () => {
    const r = await aplicar("bajas", [
      { id: 1, tabla: "variantes", clave: "C-100", borrado_en: T },
    ]);
    expect(r.error?.code).toBe("22023");
  });

  test("los microsegundos del sello se conservan en la base", async () => {
    await aplicar("existencias", [
      { ...buena, actualizado_en: "2026-10-07T10:00:00.123456+00:00" },
    ]);
    const { data } = await service.from("bodega_existencias").select("bodega_actualizado_en");
    expect(data?.[0]?.bodega_actualizado_en).toMatch(/\.123456/);
  });
});

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------
describe("permisos de las tablas nuevas", () => {
  beforeEach(async () => {
    await aplicar("existencias", [buena]);
    await aplicar(
      "variantes",
      [
        {
          id: "00000000-0000-4000-8000-000000000001",
          item_codigo_interno: "OK-1",
          proveedor: null,
          estado: "CONFIRMED",
          descartada: false,
          promovida: false,
          actualizado_en: T,
        },
      ],
      { desde: "2026-10-07T10:00:00.000001Z", despues: "x" },
    );
  });

  test.each([
    ["admin", () => admin],
    ["vendedor", () => vendedor],
  ])("%s lee existencias y variantes", async (_n, cual) => {
    const e = await cual().from("bodega_existencias").select("no_item");
    expect(e.error).toBeNull();
    expect(e.data).toHaveLength(1);
    const v = await cual().from("bodega_variantes").select("id");
    expect(v.error).toBeNull();
    expect(v.data).toHaveLength(1);
  });

  test.each([
    ["admin", () => admin],
    ["vendedor", () => vendedor],
  ])("%s no puede escribir ni borrar", async (_n, cual) => {
    const c = cual();
    const ins = await c
      .from("bodega_existencias")
      .insert({ no_item: "HACK", bodega_actualizado_en: T });
    expect(ins.error).not.toBeNull();
    const upd = await c.from("bodega_existencias").update({ activa: false }).eq("no_item", "OK-1");
    // Sin grant de UPDATE el error es de permisos; con RLS sin policy afectaría 0 filas.
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const del = await c.from("bodega_variantes").delete().neq("estado", "");
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);

    const { data } = await service
      .from("bodega_existencias")
      .select("activa")
      .eq("no_item", "OK-1");
    expect(data?.[0]?.activa).toBe(true);
    expect(await contar("bodega_existencias")).toBe(1);
  });

  test("anon no lee nada", async () => {
    for (const tabla of ["bodega_existencias", "bodega_variantes", "bodega_sync_cursor"] as const) {
      const r = await anon.from(tabla).select("*");
      expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
    }
  });

  test("el cursor es solo de service_role: ni admin ni vendedor lo ven", async () => {
    for (const c of [admin, vendedor]) {
      const r = await c.from("bodega_sync_cursor").select("*");
      expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
    }
    expect(await contar("bodega_sync_cursor")).toBeGreaterThan(0);
  });

  test("solo service_role ejecuta bodega_aplicar_pagina", async () => {
    for (const c of [anon, admin, vendedor]) {
      const r = await c.rpc("bodega_aplicar_pagina", {
        p_tabla: "existencias",
        p_filas: [{ ...buena, no_item: "HACK" }] as never,
        p_cursor: CURSOR as never,
      });
      expect(r.error?.code).toBe("42501");
    }
    expect(await contar("bodega_existencias")).toBe(1);
  });

  test("las marcas de vehículo y de repuesto se leen por catalogo_marcas como siempre", async () => {
    await aplicar("marcas", [
      {
        nombre: "MANDO",
        tipo: "producto",
        procedencia: "KOREA",
        activa: true,
        alias: [],
        actualizada_en: T,
      },
    ]);
    const r = await vendedor.from("catalogo_marcas").select("nombre, tipo");
    expect(r.error).toBeNull();
    expect(r.data).toEqual([{ nombre: "MANDO", tipo: "producto" }]);
  });
});
