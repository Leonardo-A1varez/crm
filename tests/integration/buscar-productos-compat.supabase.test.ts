import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { resolverModelos } from "@/lib/catalogo/compatibilidad";
import type { Database, Json } from "@/server/db/types.gen";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { SupabaseProductsRepository } from "@/server/repositories/productos.supabase.repo";
import { CONSULTAS, MODELOS, PRODUCTOS } from "../helpers/catalogo-compat-fixtures";
import {
  CONSULTA_ACCENT_2006,
  ESCALONES_ESPERADOS,
  TERMOSTATOS_REALES,
} from "../helpers/catalogo-ranking-fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

// `buscar_productos` con filtro de vehículo contra Postgres real. Los casos son
// los mismos que corre el repo in-memory en tests/unit/catalogo/compatibilidad.test.ts:
// si las dos implementaciones se separan, falla uno de los dos.

type Authed = SupabaseClient<Database>;

const PASSWORD = "buscar-compat-2026!secret";
const EMAILS = {
  admin: "buscar-compat-admin@crm.local",
  vendedor: "buscar-compat-vendedor@crm.local",
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
    throw new Error("RLS tests requieren SUPABASE_TEST_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY");
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

async function sembrarModelos(): Promise<void> {
  const { error: del } = await service
    .from("catalogo_modelos")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (del) throw new Error(`limpiar catalogo_modelos: ${del.message}`);
  const { error } = await service
    .from("catalogo_modelos")
    .insert(MODELOS.map((m) => ({ ...m, alias: [...m.alias] })));
  if (error) throw new Error(`sembrar catalogo_modelos: ${error.message}`);
}

async function sembrarProductos(): Promise<void> {
  const { error } = await service.from("productos").insert(
    PRODUCTOS.map((p) => ({
      codigo_interno: p.codigo,
      nombre: p.nombre,
      precio: 10,
      stock: 1,
      compatibilidad: p.compatibilidad as unknown as Json,
    })),
  );
  if (error) throw new Error(`sembrar productos: ${error.message}`);
}

beforeAll(async () => {
  service = makeTestSupabaseClient();
  await cleanupTestDb(service);
  await sembrarModelos();
  await sembrarProductos();
  userIds.push(await crearUsuario(EMAILS.admin, "admin"));
  userIds.push(await crearUsuario(EMAILS.vendedor, "vendedor"));
  admin = await entrar(EMAILS.admin);
  vendedor = await entrar(EMAILS.vendedor);
  anon = nuevoCliente();
});

afterAll(async () => {
  await service.from("catalogo_modelos").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await cleanupTestDb(service);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
});

describe("buscar_productos con vehículo (SQL)", () => {
  test.each(CONSULTAS.map((c) => [c.nombre, c] as const))("%s", async (_n, c) => {
    const repo = new SupabaseProductsRepository(service);
    const hits = await repo.search({
      q: "termostato",
      ...(c.marca ? { marca: c.marca } : {}),
      ...(c.modelo ? { modelo: c.modelo } : {}),
      ...(c.anio !== undefined ? { anio: c.anio } : {}),
      ...(c.cilindrada ? { cilindrada: c.cilindrada } : {}),
      tope: 50,
    });
    expect(hits.map((h) => h.codigo_interno).sort()).toEqual([...c.esperados].sort());
  });

  test("devuelve solo los elementos de compatibilidad que justifican el match", async () => {
    const repo = new SupabaseProductsRepository(service);
    const hits = await repo.search({ q: "termostato", modelo: "Santa Fe", anio: 2014 });
    const p9 = hits.find((h) => h.codigo_interno === "P9");
    expect(p9?.compatibilidad).toHaveLength(1);
    expect(p9?.compatibilidad[0]).toMatchObject({ cilindrada: "2.4", combustible: "GAS" });
  });

  test("sin vehículo devuelve toda la compatibilidad del producto", async () => {
    const repo = new SupabaseProductsRepository(service);
    const hits = await repo.search({ q: "termostato" });
    expect(hits.find((h) => h.codigo_interno === "P9")?.compatibilidad).toHaveLength(2);
    expect(hits.find((h) => h.codigo_interno === "P6")?.compatibilidad).toEqual([]);
  });

  test("sigue funcionando la llamada vieja, sin p_cilindrada", async () => {
    const { data, error } = await service.rpc("buscar_productos", {
      p_q: "termostato",
      p_marca: "Hyundai",
      p_modelo: "Accent",
      p_anio: 2008,
      p_tope: 20,
    });
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.codigo_interno).sort()).toEqual(["P1", "P2", "P6"]);
  });

  test("un modelo se activa al confirmarlo: Corsa pasa de texto a sigla", async () => {
    const antes = await service.rpc("resolver_modelos", { p_marca: "", p_modelo: "Corsa" });
    expect(antes.data).toEqual([]);

    const { error } = await service
      .from("catalogo_modelos")
      .update({ confirmado: true })
      .eq("sigla_modelo", "COR");
    expect(error).toBeNull();
    try {
      const despues = await service.rpc("resolver_modelos", { p_marca: "", p_modelo: "Corsa" });
      expect(despues.data).toEqual([
        { marca: "chevrolet", sigla: "cor", nombre: "chevrolet corsa", exacto: true },
      ]);

      const repo = new SupabaseProductsRepository(service);
      const hits = await repo.search({ q: "termostato", modelo: "Corsa", tope: 50 });
      expect(hits.map((h) => h.codigo_interno).sort()).toEqual(["P6", "P7"]);
    } finally {
      await service
        .from("catalogo_modelos")
        .update({ confirmado: false })
        .eq("sigla_modelo", "COR");
    }
  });
});

describe("resolver_modelos == resolverModelos (paridad SQL / TypeScript)", () => {
  const preguntas: Array<[string, string]> = [
    ["Hyundai", "Accent"],
    ["", "accent"],
    ["Hyundai", "ACCÉNT"],
    ["Hyundai", "STA FE"],
    ["", "Santafe"],
    ["", "Hyundai Santa Fe"],
    ["Hyundai", "Tucson"],
    ["", "Corsa"],
    ["", "Vitara"],
    ["Chevrolet", "Vitara"],
    ["Suzuki", "Vitara"],
    ["Kia", "Accent"],
    ["", "Picanto"],
    ["Kia", "Picanto"],
    ["", "acc%"],
    ["", "%"],
    ["", "_"],
    ["Hyundai", ""],
  ];
  test.each(preguntas)("marca=%j modelo=%j", async (marca, modelo) => {
    const { data, error } = await service.rpc("resolver_modelos", {
      p_marca: marca,
      p_modelo: modelo,
    });
    expect(error).toBeNull();
    const clave = (r: { marca: string; sigla: string; nombre: string; exacto: boolean }) =>
      `${r.marca}|${r.sigla}|${r.nombre}|${r.exacto}`;
    expect((data ?? []).map(clave).sort()).toEqual(
      resolverModelos(MODELOS, marca, modelo).map(clave).sort(),
    );
  });
});

describe("catalogo_modelos: permisos", () => {
  test("el vendedor lee el diccionario", async () => {
    const { data, error } = await vendedor.from("catalogo_modelos").select("sigla_modelo");
    expect(error).toBeNull();
    expect(data?.length).toBe(MODELOS.length);
  });

  test("el vendedor no escribe: insert, update ni delete", async () => {
    const ins = await vendedor
      .from("catalogo_modelos")
      .insert({ marca: "Kia", sigla_modelo: "ZZ", nombre_real: "Kia Zz", confianza: "alta" });
    expect(ins.error).not.toBeNull();

    // Update y delete bloqueados por RLS no dan error: afectan 0 filas.
    const upd = await vendedor
      .from("catalogo_modelos")
      .update({ nombre_real: "Hackeado" })
      .eq("sigla_modelo", "ACC")
      .select();
    expect(upd.data ?? []).toEqual([]);
    const del = await vendedor.from("catalogo_modelos").delete().eq("sigla_modelo", "ACC").select();
    expect(del.data ?? []).toEqual([]);

    const { data } = await service
      .from("catalogo_modelos")
      .select("nombre_real")
      .eq("sigla_modelo", "ACC")
      .single();
    expect(data?.nombre_real).toBe("Hyundai Accent");
  });

  test("el admin escribe", async () => {
    const ins = await admin
      .from("catalogo_modelos")
      .insert({ marca: "Kia", sigla_modelo: "ZZ", nombre_real: "Kia Zz", confianza: "baja" })
      .select()
      .single();
    expect(ins.error).toBeNull();
    expect(ins.data?.activo).toBe(false);
    expect(ins.data?.nombre_clave).toBe("zz");

    const del = await admin.from("catalogo_modelos").delete().eq("sigla_modelo", "ZZ");
    expect(del.error).toBeNull();
  });

  test("anónimo no lee ni escribe", async () => {
    const sel = await anon.from("catalogo_modelos").select("id");
    expect(sel.error !== null || (sel.data ?? []).length === 0).toBe(true);
    const ins = await anon
      .from("catalogo_modelos")
      .insert({ marca: "Kia", sigla_modelo: "ZZ", nombre_real: "Kia Zz", confianza: "alta" });
    expect(ins.error).not.toBeNull();
  });

  test("anónimo no ejecuta buscar_productos ni resolver_modelos", async () => {
    const a = await anon.rpc("buscar_productos", { p_q: "termostato" });
    expect(a.error).not.toBeNull();
    const b = await anon.rpc("resolver_modelos", { p_marca: "", p_modelo: "accent" });
    expect(b.error).not.toBeNull();
  });

  test("la sigla es única por marca", async () => {
    const dup = await service
      .from("catalogo_modelos")
      .insert({ marca: "Hyundai", sigla_modelo: "ACC", nombre_real: "Otro", confianza: "alta" });
    expect(dup.error).not.toBeNull();
  });
});

// Va al final: reemplaza los productos de arriba por las filas reales del
// termostato del Accent, y los demás describe leen `productos`.
describe("buscar_productos ordena por cuánto confirma el vehículo (filas reales)", () => {
  beforeAll(async () => {
    const { error: del } = await service
      .from("productos")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (del) throw new Error(`limpiar productos: ${del.message}`);
    const { error } = await service.from("productos").insert(
      TERMOSTATOS_REALES.map((p) => ({
        codigo_interno: p.codigo,
        nombre: p.nombre,
        categoria: p.categoria,
        descripcion: p.descripcion,
        precio: p.precio,
        stock: p.stock,
        compatibilidad: p.compatibilidad as unknown as Json,
      })),
    );
    if (error) throw new Error(`sembrar termostatos reales: ${error.message}`);
  });

  test("la consulta exacta de la conversación real: los escalones salen en el orden correcto", async () => {
    const repo = new SupabaseProductsRepository(service);
    const hits = await repo.search({ ...CONSULTA_ACCENT_2006 });
    expect(hits).toHaveLength(TERMOSTATOS_REALES.length);

    const orden = hits.map((h) => h.codigo_interno);
    let desde = 0;
    for (const escalon of ESCALONES_ESPERADOS) {
      const tramo = orden.slice(desde, desde + escalon.length);
      expect([...tramo].sort()).toEqual([...escalon].sort());
      desde += escalon.length;
    }
  });

  test.each([
    ["19309", 7],
    ["9028", 5],
    ["24570", 4],
    ["12088", 0],
    ["25530", -1],
    ["12249", -2],
  ])("nivel_vehiculo de %s = %i", async (codigo, nivel) => {
    const repo = new SupabaseProductsRepository(service);
    const hits = await repo.search({ ...CONSULTA_ACCENT_2006 });
    expect(hits.find((h) => h.codigo_interno === codigo)?.nivel_vehiculo).toBe(nivel);
  });

  test("sin año ni cilindrada pedidos lo declarado de más no suma (modelo exacto 4, Verna 0, sin dato -1)", async () => {
    const repo = new SupabaseProductsRepository(service);
    const hits = await repo.search({
      q: "termostato",
      marca: "Hyundai",
      modelo: "Accent",
      tope: 50,
    });
    const nivel = (c: string) => hits.find((h) => h.codigo_interno === c)?.nivel_vehiculo;
    expect(nivel("19309")).toBe(4);
    expect(nivel("9028")).toBe(4);
    expect(nivel("12088")).toBe(0);
    expect(nivel("25530")).toBe(-1);
  });

  test("sin vehículo todos valen 0", async () => {
    const repo = new SupabaseProductsRepository(service);
    const hits = await repo.search({ q: "termostato", tope: 50 });
    expect(new Set(hits.map((h) => h.nivel_vehiculo))).toEqual(new Set([0]));
  });

  test("el repo in-memory y Postgres dan el mismo nivel a cada producto, para varias consultas", async () => {
    const memoria = new InMemoryProductsRepository({ modelos: MODELOS });
    for (const p of TERMOSTATOS_REALES) {
      await memoria.create({
        codigo_interno: p.codigo,
        sku_proveedor: null,
        nombre: p.nombre,
        descripcion: p.descripcion,
        categoria: p.categoria,
        compatibilidad: p.compatibilidad as never,
        precio: p.precio,
        stock: p.stock,
        imagen_url: null,
        activo: true,
      });
    }
    const sql = new SupabaseProductsRepository(service);
    const consultas = [
      { ...CONSULTA_ACCENT_2006 },
      { q: "termostato", marca: "Hyundai", modelo: "Accent", tope: 50 },
      { q: "termostato", modelo: "Accent", anio: 2006, tope: 50 },
      { q: "termostato", marca: "Hyundai", modelo: "Accent", cilindrada: "1.4", tope: 50 },
      { q: "termostato", marca: "Hyundai", modelo: "Accent", anio: 2002, tope: 50 },
      { q: "termostato", marca: "Hyundai", tope: 50 },
      { q: "termostato", tope: 50 },
    ];
    for (const c of consultas) {
      const nivelesSql = new Map(
        (await sql.search(c)).map((h) => [h.codigo_interno, h.nivel_vehiculo]),
      );
      const nivelesMem = new Map(
        (await memoria.search(c)).map((h) => [h.codigo_interno, h.nivel_vehiculo]),
      );
      expect(nivelesSql, JSON.stringify(c)).toEqual(nivelesMem);
    }
  });
});
