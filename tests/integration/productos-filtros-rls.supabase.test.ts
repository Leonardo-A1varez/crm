import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PermissionDeniedError } from "@/lib/errors";
import {
  parseOpcionesFacetas,
  parseProductosFiltros,
} from "@/lib/validation/productos-filtros.schema";
import type { Database } from "@/server/db/types.gen";
import { SupabaseProductsRepository } from "@/server/repositories/productos.supabase.repo";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

// Las funciones de filtros de /productos son `security invoker`: tienen que
// respetar la RLS de `productos` (select para admin y vendedor) y no abrirse a
// anon. El contrato corre con service-role, que se salta la RLS; esto cubre el
// camino que usa el panel de verdad.

type Authed = SupabaseClient<Database>;

const PASSWORD = "productos-filtros-rls-2026!secret";
const EMAILS = {
  admin: "productos-filtros-admin@crm.local",
  vendedor: "productos-filtros-vendedor@crm.local",
  sinRol: "productos-filtros-sinrol@crm.local",
} as const;

let service: TestClient;
let admin: Authed;
let vendedor: Authed;
let sinRol: Authed;
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

async function crearUsuario(email: string, rol: "admin" | "vendedor" | null): Promise<string> {
  const app_metadata = rol === null ? {} : { rol };
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
  userIds.push(await crearUsuario(EMAILS.sinRol, null));
  admin = await entrar(EMAILS.admin);
  vendedor = await entrar(EMAILS.vendedor);
  sinRol = await entrar(EMAILS.sinRol);
  anon = nuevoCliente();

  const { error } = await service.from("productos").insert([
    { codigo_interno: "R-1", nombre: "Radiador uno", categoria: "RADIADOR", precio: 10, stock: 1 },
    { codigo_interno: "R-2", nombre: "Radiador dos", categoria: "RADIADOR", precio: 20, stock: 0 },
  ]);
  if (error) throw new Error(`seed productos: ${error.message}`);
}, 120_000);

afterAll(async () => {
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await service.from("usuarios").delete().in("email", Object.values(EMAILS));
  await cleanupTestDb(service);
}, 120_000);

const opc = () => parseOpcionesFacetas({});

describe("productos: filtros y facetas bajo RLS", () => {
  const filtros = parseProductosFiltros({ categorias: "RADIADOR" });

  test.each([
    ["admin", () => admin],
    ["vendedor", () => vendedor],
  ])("%s ve el catálogo filtrado, paginado y las facetas", async (_rol, cliente) => {
    const repo = new SupabaseProductsRepository(cliente());
    const pagina = await repo.listarFiltrado(filtros);
    expect(pagina.total).toBe(2);
    // Orden por nombre: "Radiador dos" va antes que "Radiador uno".
    expect(pagina.items.map((p) => p.codigo_interno)).toEqual(["R-2", "R-1"]);
    const facetas = await repo.facetas(filtros, opc());
    expect(facetas.categorias.valores).toEqual([{ valor: "RADIADOR", cantidad: 2 }]);
  });

  test("un usuario sin rol no ve filas: la RLS recorta igual que en una consulta directa", async () => {
    const repo = new SupabaseProductsRepository(sinRol);
    const pagina = await repo.listarFiltrado(filtros);
    expect(pagina.total).toBe(0);
    expect(pagina.items).toEqual([]);
    expect((await repo.facetas(filtros, opc())).categorias.valores).toEqual([
      { valor: "RADIADOR", cantidad: 0 },
    ]);
  });

  test("anon no puede ejecutar las funciones", async () => {
    const repo = new SupabaseProductsRepository(anon);
    await expect(repo.listarFiltrado(filtros)).rejects.toThrow(PermissionDeniedError);
    await expect(repo.facetas(filtros, opc())).rejects.toThrow(PermissionDeniedError);
  });
});
