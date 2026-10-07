import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/types.gen";
import { SupabaseCatalogoMarcasRepository } from "@/server/repositories/catalogo-marcas.supabase.repo";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

// La carga de `marcas` por las mismas RPC del ERP, contra Postgres real: la forma
// de la fila, la compuerta de la clave, la baja (activa = false) y los permisos de
// `catalogo_marcas`. Contrato: docs/integraciones/erp-oracle-contrato-crm.md §3.4.

type Authed = SupabaseClient<Database>;
type FilaMarca = Record<string, unknown>;

const PASSWORD = "erp-marcas-2026!secret";
const EMAILS = {
  admin: "erp-marcas-admin@crm.local",
  vendedor: "erp-marcas-vendedor@crm.local",
} as const;

const CLAVE = randomBytes(32).toString("base64url");
const CLAVE_MALA = randomBytes(32).toString("base64url");

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

const marca = (over: FilaMarca = {}): FilaMarca => ({
  nombre: "MOBIS",
  tipo: "original",
  procedencia: "ORIGINAL",
  activa: true,
  alias: ["HYUNDAI MOBIS"],
  ...over,
});

const cargar = (filas: unknown, clave = CLAVE, tabla = "marcas") =>
  anon.rpc("erp_sync_cargar", { p_clave: clave, p_tabla: tabla, p_filas: filas as never });

const borrar = (claves: unknown, clave = CLAVE, tabla = "marcas") =>
  anon.rpc("erp_sync_borrar", { p_clave: clave, p_tabla: tabla, p_claves: claves as never });

async function guardada(nombre: string) {
  const { data, error } = await service
    .from("catalogo_marcas")
    .select("*")
    .eq("nombre", nombre)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function contar(): Promise<number> {
  const { count, error } = await service
    .from("catalogo_marcas")
    .select("nombre", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function limpiar(): Promise<void> {
  const { error } = await service.from("catalogo_marcas").delete().neq("nombre", "");
  if (error) throw new Error(error.message);
}

beforeAll(async () => {
  service = makeTestSupabaseClient();
  await cleanupTestDb(service);
  const hash = createHash("sha256").update(CLAVE).digest("hex");
  const { error } = await service.rpc("erp_sync_clave_fijar", { p_clave_hash: hash });
  if (error) throw new Error(`erp_sync_clave_fijar: ${error.message}`);
  userIds.push(await crearUsuario(EMAILS.admin, "admin"));
  userIds.push(await crearUsuario(EMAILS.vendedor, "vendedor"));
  admin = await entrar(EMAILS.admin);
  vendedor = await entrar(EMAILS.vendedor);
  anon = nuevoCliente();
});

beforeEach(async () => {
  await limpiar();
});

afterAll(async () => {
  await limpiar();
  await cleanupTestDb(service);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
});

describe("compuerta de marcas", () => {
  test("clave equivocada, nula o corta → 42501 y no cambia nada", async () => {
    for (const clave of [CLAVE_MALA, null, "", "corta"]) {
      const r = await cargar([marca()], clave as unknown as string);
      expect(r.error?.code).toBe("42501");
      const b = await borrar([{ nombre: "MOBIS" }], clave as unknown as string);
      expect(b.error?.code).toBe("42501");
    }
    expect(await contar()).toBe(0);
  });

  test("la clave se valida antes que la tabla, y el error no repite la clave", async () => {
    const r = await cargar([marca()], CLAVE_MALA, "usuarios");
    expect(r.error?.code).toBe("42501");
    const texto = JSON.stringify(r.error);
    expect(texto).not.toContain(CLAVE_MALA);
    expect(texto).not.toContain(CLAVE);
  });

  test("la lista de tablas sigue cerrada: solo productos y marcas", async () => {
    for (const tabla of ["usuarios", "leads", "catalogo_marcas", "MARCAS", "Marcas", ""]) {
      const r = await cargar([marca()], CLAVE, tabla);
      expect(r.error?.code).toBe("22023");
      const b = await borrar([{ nombre: "MOBIS" }], CLAVE, tabla);
      expect(b.error?.code).toBe("22023");
    }
    expect(await contar()).toBe(0);
  });

  test("más de 5000 filas o claves → 54000; lote vacío → 0; lote que no es arreglo → 22023", async () => {
    const filas = Array.from({ length: 5001 }, (_, i) => marca({ nombre: `M${i}`, alias: [] }));
    expect((await cargar(filas)).error?.code).toBe("54000");
    expect((await borrar(filas.map((f) => ({ nombre: f["nombre"] })))).error?.code).toBe("54000");
    expect(await cargar([])).toMatchObject({ data: 0, error: null });
    expect(await borrar([])).toMatchObject({ data: 0, error: null });
    expect((await cargar({ nombre: "MOBIS" })).error?.code).toBe("22023");
    expect(await contar()).toBe(0);
  });
});

describe("validación de filas de marcas: un error rechaza el lote entero", () => {
  const malas: [string, FilaMarca, RegExp][] = [
    ["campo desconocido", marca({ pais: "KOREA" }), /campo desconocido pais/],
    ["nombre ausente", (({ nombre: _n, ...resto }) => resto)(marca()), /nombre/],
    ["nombre vacío", marca({ nombre: "   " }), /nombre/],
    ["nombre que no es texto", marca({ nombre: 555 }), /nombre/],
    ["nombre de 101 caracteres", marca({ nombre: "A".repeat(101) }), /nombre/],
    ["tipo que no es texto", marca({ tipo: 1 }), /tipo/],
    ["procedencia que no es texto", marca({ procedencia: ["KOREA"] }), /procedencia/],
    ["procedencia de 51 caracteres", marca({ procedencia: "K".repeat(51) }), /procedencia/],
    ["activa como texto", marca({ activa: "true" }), /activa/],
    ["alias que no es arreglo", marca({ alias: "HYUNDAI MOBIS" }), /alias/],
    ["alias con un número", marca({ alias: ["OK", 7] }), /alias/],
    ["alias con un blanco", marca({ alias: ["  "] }), /alias/],
    ["alias de 101 caracteres", marca({ alias: ["A".repeat(101)] }), /alias/],
    ["51 alias", marca({ alias: Array.from({ length: 51 }, (_, i) => `A${i}`) }), /alias/],
  ];

  test.each(malas)("%s → 22023 con el número de fila y sin escribir nada", async (_n, mala, re) => {
    const r = await cargar([marca({ nombre: "BUENA", alias: [] }), mala]);
    expect(r.error?.code).toBe("22023");
    expect(r.error?.message).toMatch(/^fila 2:/);
    expect(r.error?.message).toMatch(re);
    expect(await contar()).toBe(0);
  });

  test("un elemento que no es objeto → 22023", async () => {
    const r = await cargar([marca(), "MOBIS"]);
    expect(r.error?.code).toBe("22023");
    expect(r.error?.message).toMatch(/^fila 2:/);
    expect(await contar()).toBe(0);
  });

  test("nombre repetido en el lote, aunque cambie la mayúscula → 22023", async () => {
    const r = await cargar([marca({ nombre: "MOBIS" }), marca({ nombre: "Mobis" })]);
    expect(r.error?.code).toBe("22023");
    expect(r.error?.message).toMatch(/repetido en el lote/);
    expect(await contar()).toBe(0);
  });

  test("el índice único por minúsculas rechaza 'Mobis' si ya existe 'MOBIS'", async () => {
    expect((await cargar([marca({ nombre: "MOBIS" })])).data).toBe(1);
    const r = await cargar([marca({ nombre: "Mobis" })]);
    expect(r.error).not.toBeNull();
    expect(await contar()).toBe(1);
  });
});

describe("carga de marcas", () => {
  test("guarda cada campo; los blancos y null quedan como null y el alias como arreglo", async () => {
    const r = await cargar([
      marca(),
      marca({ nombre: "  TAIHO  ", tipo: "  ", procedencia: null, activa: null, alias: null }),
      { nombre: "KRC" },
    ]);
    expect(r.error).toBeNull();
    expect(r.data).toBe(3);

    expect(await guardada("MOBIS")).toMatchObject({
      tipo: "original",
      procedencia: "ORIGINAL",
      activa: true,
      alias: ["HYUNDAI MOBIS"],
    });
    expect(await guardada("TAIHO")).toMatchObject({
      tipo: null,
      procedencia: null,
      activa: true,
      alias: [],
    });
    expect(await guardada("KRC")).toMatchObject({ tipo: null, procedencia: null, activa: true });
    expect((await guardada("MOBIS"))?.erp_actualizado_at).not.toBeNull();
  });

  test("recargar lo mismo escribe 0 filas y no toca erp_actualizado_at; un cambio escribe solo esa", async () => {
    await cargar([marca(), marca({ nombre: "MANDO", procedencia: "KOREA", alias: [] })]);
    const antes = await guardada("MOBIS");

    const igual = await cargar([
      marca(),
      marca({ nombre: "MANDO", procedencia: "KOREA", alias: [] }),
    ]);
    expect(igual.data).toBe(0);
    expect((await guardada("MOBIS"))?.erp_actualizado_at).toBe(antes?.erp_actualizado_at);

    const cambio = await cargar([
      marca(),
      marca({ nombre: "MANDO", procedencia: "JAPON", alias: [] }),
    ]);
    expect(cambio.data).toBe(1);
    expect((await guardada("MANDO"))?.procedencia).toBe("JAPON");
    expect((await guardada("MOBIS"))?.erp_actualizado_at).toBe(antes?.erp_actualizado_at);
  });

  test("un cambio de alias cuenta como cambio", async () => {
    await cargar([marca()]);
    const r = await cargar([marca({ alias: ["HYUNDAI MOBIS", "HMOBIS"] })]);
    expect(r.data).toBe(1);
    expect((await guardada("MOBIS"))?.alias).toEqual(["HYUNDAI MOBIS", "HMOBIS"]);
  });

  test("cargar marcas no toca productos", async () => {
    const { count } = await service.from("productos").select("id", { count: "exact", head: true });
    await cargar([marca()]);
    const { count: despues } = await service
      .from("productos")
      .select("id", { count: "exact", head: true });
    expect(despues).toBe(count);
  });
});

describe("baja de marcas: activa = false, nunca borra", () => {
  test("borrar desactiva, devuelve cuántas y recargar la reactiva", async () => {
    await cargar([marca(), marca({ nombre: "MANDO", procedencia: "KOREA", alias: [] })]);

    const b = await borrar([{ nombre: "MOBIS" }, { nombre: "NO EXISTE" }]);
    expect(b.data).toBe(1);
    expect((await guardada("MOBIS"))?.activa).toBe(false);
    expect((await guardada("MANDO"))?.activa).toBe(true);
    expect(await contar()).toBe(2);

    expect((await borrar([{ nombre: "MOBIS" }])).data).toBe(0);

    expect((await cargar([marca()])).data).toBe(1);
    expect((await guardada("MOBIS"))?.activa).toBe(true);
  });

  test.each([
    ["no es objeto", ["MOBIS"]],
    ["con la clave de productos", [{ no_item: "7" }]],
    ["con una clave de más", [{ nombre: "MOBIS", extra: 1 }]],
    ["nombre vacío", [{ nombre: " " }]],
    ["nombre que no es texto", [{ nombre: 1 }]],
  ])("clave mal formada (%s) → 22023 y no toca nada", async (_n, claves) => {
    await cargar([marca()]);
    const r = await borrar(claves);
    expect(r.error?.code).toBe("22023");
    expect((await guardada("MOBIS"))?.activa).toBe(true);
  });

  test("borrar con la forma de marcas en 'productos' también se rechaza", async () => {
    const r = await borrar([{ nombre: "MOBIS" }], CLAVE, "productos");
    expect(r.error?.code).toBe("22023");
  });
});

describe("permisos de catalogo_marcas", () => {
  test("anon no lee ni escribe la tabla", async () => {
    await cargar([marca()]);
    const lee = await anon.from("catalogo_marcas").select("nombre");
    expect(lee.error).not.toBeNull();
    const escribe = await anon.from("catalogo_marcas").insert({ nombre: "X" });
    expect(escribe.error).not.toBeNull();
    expect(await contar()).toBe(1);
  });

  test("admin y vendedor leen pero no escriben, ni siquiera lo suyo", async () => {
    await cargar([marca()]);
    for (const c of [admin, vendedor]) {
      const lee = await c.from("catalogo_marcas").select("nombre, procedencia");
      expect(lee.error).toBeNull();
      expect(lee.data).toEqual([{ nombre: "MOBIS", procedencia: "ORIGINAL" }]);

      expect((await c.from("catalogo_marcas").insert({ nombre: "X" })).error).not.toBeNull();
      await c.from("catalogo_marcas").update({ procedencia: "CHINA" }).eq("nombre", "MOBIS");
      await c.from("catalogo_marcas").delete().eq("nombre", "MOBIS");
    }
    expect((await guardada("MOBIS"))?.procedencia).toBe("ORIGINAL");
    expect(await contar()).toBe(1);
  });

  test("authenticated no ejecuta las RPC de carga", async () => {
    for (const c of [admin, vendedor]) {
      const r = await c.rpc("erp_sync_cargar", {
        p_clave: CLAVE,
        p_tabla: "marcas",
        p_filas: [marca()] as never,
      });
      expect(r.error).not.toBeNull();
    }
    expect(await contar()).toBe(0);
  });
});

describe("SupabaseCatalogoMarcasRepository", () => {
  test("lista solo las activas, con su alias", async () => {
    await cargar([
      marca(),
      marca({ nombre: "MANDO", procedencia: "KOREA", alias: [] }),
      marca({ nombre: "VIEJA", procedencia: "CHINA", activa: false, alias: [] }),
    ]);
    const lista = await new SupabaseCatalogoMarcasRepository(service).listarActivas();
    expect(lista.map((m) => m.nombre).sort()).toEqual(["MANDO", "MOBIS"]);
    expect(lista.find((m) => m.nombre === "MOBIS")).toEqual({
      nombre: "MOBIS",
      tipo: "original",
      procedencia: "ORIGINAL",
      activa: true,
      alias: ["HYUNDAI MOBIS"],
    });
  });
});
