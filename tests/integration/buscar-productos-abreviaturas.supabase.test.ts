import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { indexarAbreviaturas } from "@/lib/catalogo/abreviaturas";
import type { Database, Json } from "@/server/db/types.gen";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { SupabaseCatalogoAbreviaturasRepository } from "@/server/repositories/catalogo-abreviaturas.supabase.repo";
import { SupabaseProductsRepository } from "@/server/repositories/productos.supabase.repo";
import { armarSalida } from "@/server/services/catalog-matcher.service";
import { ABREVIATURAS, AMORTIGUADORES_NIRO } from "../helpers/catalogo-abreviaturas-fixtures";
import type { ProductoReal } from "../helpers/catalogo-ranking-fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

// `buscar_productos` con abreviaturas del inventario, lados y grupos excluidos contra
// Postgres real. El caso es el real de crm-dev (2026-10-07 19:12 UTC): «amortiguadores
// delanteros» para un Kia Niro 2020. Los mismos casos corren en memoria
// (tests/unit/catalogo/buscar-abreviaturas.test.ts) y se comparan entre sí.

type Authed = SupabaseClient<Database>;

const PASSWORD = "buscar-abrev-2026!secret";
const EMAILS = {
  admin: "buscar-abrev-admin@crm.local",
  vendedor: "buscar-abrev-vendedor@crm.local",
} as const;
const NIRO = { marca: "Kia", modelo: "Niro", anio: 2020, tope: 20 } as const;

let service: TestClient;
let admin: Authed;
let vendedor: Authed;
let anon: Authed;
const userIds: string[] = [];

const niro = (desde: number | null) => ({
  marca: "Kia",
  modelo: "NIRO",
  modelo_nombre: "Kia Niro",
  anio_desde: desde,
  anio_hasta: null,
  cilindrada: null,
  combustible: null,
});

const EXTRA: ProductoReal[] = [
  // Otra pieza del Niro que comparte la palabra por prefijo (BASE AMORTIGUADOR).
  {
    codigo: "24033",
    nombre: "KIA NIRO 1.6 16- IONIQ 1.6 17-",
    categoria: "BASE AMORTIGUADOR",
    descripcion: "MOBIS",
    precio: 25.5,
    stock: 6,
    compatibilidad: [niro(2016)],
  },
  // Amortiguador de otro auto, sin compatibilidad cargada ("no sabemos").
  {
    codigo: "2217",
    nombre: "CH COR EVOL RH",
    categoria: "AMORTIG DELT",
    descripcion: "MANDO",
    precio: 27.99,
    stock: 10,
    compatibilidad: [],
  },
  // Un gasto de la empresa con la palabra en el nombre: nunca se busca.
  {
    codigo: "G1",
    nombre: "PAGO AMORTIGUADORES PROVEEDOR",
    categoria: "GASTOS VARIOS",
    descripcion: null,
    precio: 50,
    stock: 112,
    compatibilidad: [],
  },
  // El modelo está en modelo_nombre y no en catalogo_modelos (la tabla está vacía acá).
  {
    codigo: "H1",
    nombre: "HY 06- 1.4",
    categoria: "BOMBA DE AGUA",
    descripcion: null,
    precio: 20,
    stock: 3,
    compatibilidad: [
      {
        marca: "Hyundai",
        modelo: "ACC",
        modelo_nombre: "Hyundai Accent",
        anio_desde: 2006,
        anio_hasta: null,
        cilindrada: null,
        combustible: null,
      },
    ],
  },
];

const TODOS = [...AMORTIGUADORES_NIRO, ...EXTRA];

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

async function sembrarAbreviaturas(): Promise<void> {
  const { error: del } = await service.from("catalogo_abreviaturas").delete().neq("abrev", "");
  if (del) throw new Error(`limpiar catalogo_abreviaturas: ${del.message}`);
  const { error } = await service.from("catalogo_abreviaturas").insert(ABREVIATURAS);
  if (error) throw new Error(`sembrar catalogo_abreviaturas: ${error.message}`);
}

async function sembrarProductos(): Promise<void> {
  const { error } = await service.from("productos").insert(
    TODOS.map((p) => ({
      codigo_interno: p.codigo,
      nombre: p.nombre,
      categoria: p.categoria,
      descripcion: p.descripcion,
      precio: p.precio,
      stock: p.stock,
      compatibilidad: p.compatibilidad as unknown as Json,
    })),
  );
  if (error) throw new Error(`sembrar productos: ${error.message}`);
}

/** El espejo en memoria con las mismas abreviaturas y los mismos grupos que la base. */
async function enMemoria(): Promise<InMemoryProductsRepository> {
  const { data: grupos } = await service.from("catalogo_grupos_excluidos").select("grupo");
  const memoria = new InMemoryProductsRepository({
    abreviaturas: ABREVIATURAS,
    gruposExcluidos: (grupos ?? []).map((g) => g.grupo),
  });
  for (const p of TODOS) {
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
  return memoria;
}

beforeAll(async () => {
  service = makeTestSupabaseClient();
  await cleanupTestDb(service);
  await service.from("catalogo_modelos").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await sembrarAbreviaturas();
  await sembrarProductos();
  userIds.push(await crearUsuario(EMAILS.admin, "admin"));
  userIds.push(await crearUsuario(EMAILS.vendedor, "vendedor"));
  admin = await entrar(EMAILS.admin);
  vendedor = await entrar(EMAILS.vendedor);
  anon = nuevoCliente();
});

afterAll(async () => {
  await service.from("catalogo_abreviaturas").delete().neq("abrev", "");
  await cleanupTestDb(service);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
});

describe("«amortiguadores delanteros» para el Kia Niro 2020 (SQL)", () => {
  test("encuentra el izquierdo y el derecho primero; no el trasero ni la basura ni el gasto", async () => {
    const repo = new SupabaseProductsRepository(service);
    const hits = await repo.search({ q: "amortiguadores delanteros", ...NIRO });
    const codigos = hits.map((h) => h.codigo_interno);
    expect(codigos.slice(0, 2)).toEqual(["23868", "23869"]);
    expect(codigos).not.toContain("23870"); // AMORTIG POST
    expect(codigos).not.toContain("24695"); // REPUESTO EMG (grupo excluido)
    expect(codigos).not.toContain("24696");
    expect(codigos).not.toContain("G1"); // GASTOS VARIOS (grupo excluido)
    expect(hits[0]).toMatchObject({ nivel_vehiculo: 5 });
  });

  test("pidiendo «traseros» sale el trasero y no los delanteros", async () => {
    const repo = new SupabaseProductsRepository(service);
    const codigos = (await repo.search({ q: "amortiguadores traseros", ...NIRO })).map(
      (h) => h.codigo_interno,
    );
    expect(codigos[0]).toBe("23870");
    expect(codigos).not.toContain("23868");
  });

  test("«izquierdo» deja el LH y no el RH", async () => {
    const repo = new SupabaseProductsRepository(service);
    const codigos = (await repo.search({ q: "amortiguador delantero izquierdo", ...NIRO })).map(
      (h) => h.codigo_interno,
    );
    expect(codigos[0]).toBe("23868");
    expect(codigos).not.toContain("23869");
  });

  test("la salida de la herramienta sobre filas de Postgres: dos líneas por lado, encabezado del cliente", async () => {
    const repo = new SupabaseProductsRepository(service);
    const abrevs = indexarAbreviaturas(
      await new SupabaseCatalogoAbreviaturasRepository(service).listarActivas(),
    );
    const salida = armarSalida(
      await repo.search({ q: "amortiguadores delanteros", ...NIRO }),
      { anio: 2020 },
      { query: "amortiguadores delanteros", marca: "Kia", modelo: "Niro" },
      [],
      abrevs,
    );
    expect(salida.matches.map((m) => [m.codigo_interno, m.lado, m.precio])).toEqual([
      ["23868", "izquierdo", 89.55],
      ["23869", "derecho", 94.22],
    ]);
    expect(salida.encabezado).toBe("Amortiguadores delanteros Niro 2020 (IVA incluido):");
  });

  test("sin vehículo y sin la tabla de abreviaturas, el prefijo sigue encontrando AMORTIG", async () => {
    const { error: del } = await service.from("catalogo_abreviaturas").delete().neq("abrev", "");
    expect(del).toBeNull();
    try {
      const repo = new SupabaseProductsRepository(service);
      const codigos = (await repo.search({ q: "amortiguadores", ...NIRO })).map(
        (h) => h.codigo_interno,
      );
      expect(codigos).toEqual(expect.arrayContaining(["23868", "23869", "23870"]));
    } finally {
      await sembrarAbreviaturas();
    }
  });

  test("si el grupo REPUESTO EMG no estuviera excluido, la basura queda al final y no es la primera", async () => {
    const { data: grupo } = await service
      .from("catalogo_grupos_excluidos")
      .select("*")
      .eq("grupo", "REPUESTO EMG")
      .single();
    await service.from("catalogo_grupos_excluidos").delete().eq("grupo", "REPUESTO EMG");
    try {
      const repo = new SupabaseProductsRepository(service);
      const codigos = (await repo.search({ q: "amortiguadores delanteros", ...NIRO })).map(
        (h) => h.codigo_interno,
      );
      expect(codigos.slice(0, 2)).toEqual(["23868", "23869"]);
    } finally {
      // `clave` es una columna generada: solo se reponen las que se escriben.
      if (grupo) {
        const { error } = await service
          .from("catalogo_grupos_excluidos")
          .insert({ grupo: grupo.grupo, inactivar: grupo.inactivar, motivo: grupo.motivo });
        expect(error).toBeNull();
      }
    }
  });
});

describe("el modelo aparece en modelo_nombre aunque catalogo_modelos esté vacío (SQL)", () => {
  test("«Accent» (marca en mayúsculas) sirve a un producto cuyo modelo es la sigla ACC", async () => {
    const repo = new SupabaseProductsRepository(service);
    const hits = await repo.search({
      q: "bomba de agua",
      marca: "HYUNDAI",
      modelo: "accent",
      anio: 2008,
    });
    expect(hits.map((h) => h.codigo_interno)).toEqual(["H1"]);
    expect(hits[0]?.nivel_vehiculo).toBe(5);
  });

  test("otro modelo no sirve", async () => {
    const repo = new SupabaseProductsRepository(service);
    expect(await repo.search({ q: "bomba de agua", marca: "Hyundai", modelo: "Tucson" })).toEqual(
      [],
    );
  });
});

describe("Postgres y el repo in-memory dan lo mismo", () => {
  const consultas: Array<[string, Record<string, unknown>]> = [
    ["amortiguadores delanteros", NIRO],
    ["amortiguadores traseros", NIRO],
    ["amortiguador izquierdo", NIRO],
    ["amortiguador delantero derecho", NIRO],
    ["amortiguadores", NIRO],
    ["amortiguadores", {}],
    ["amortiguadores delanteros", {}],
    ["base amortiguador", NIRO],
    ["amortig", NIRO],
    ["izquierdo", NIRO],
    ["bomba de agua", { marca: "Hyundai", modelo: "Accent", anio: 2008 }],
  ];

  test.each(consultas)(
    "«%s» %j: mismos productos, mismo orden y mismo puntaje",
    async (q, extra) => {
      const sql = new SupabaseProductsRepository(service);
      const memoria = await enMemoria();
      const c = { q, tope: 50, ...extra } as Parameters<typeof sql.search>[0];
      const a = await sql.search(c);
      const b = await memoria.search(c);
      const resumen = (hs: typeof a) =>
        hs.map((h) => `${h.codigo_interno}:${h.puntaje}:${h.nivel_vehiculo}`);
      expect(resumen(a), `${q} ${JSON.stringify(extra)}`).toEqual(resumen(b));
    },
  );
});

describe("catalogo_abreviaturas y catalogo_grupos_excluidos: columnas y permisos", () => {
  test("las columnas guardadas dejan listo lo que la búsqueda necesita", async () => {
    const { data, error } = await service
      .from("catalogo_abreviaturas")
      .select("abrev, tipo, clave, exp_raiz, lado, activo")
      .in("abrev", ["POST", "AMORTIG", "REPUESTO EMG", "LH"]);
    expect(error).toBeNull();
    const por = Object.fromEntries((data ?? []).map((r) => [r.abrev, r]));
    expect(por["POST"]).toMatchObject({ clave: "post", exp_raiz: "posterior", lado: "posterior" });
    expect(por["LH"]).toMatchObject({ lado: "izquierdo", exp_raiz: "izquierd" });
    expect(por["AMORTIG"]).toMatchObject({ exp_raiz: "amortiguador", lado: null, activo: true });
    expect(por["REPUESTO EMG"]).toMatchObject({ clave: "repuesto emg", exp_raiz: null });
  });

  test("la clave es (abrev, tipo): DEL puede ser posición y ruido a la vez", async () => {
    const base = { expansion: "x", ambito: "nombre", confianza: "baja" };
    const a = await service
      .from("catalogo_abreviaturas")
      .insert({ ...base, abrev: "DELX", tipo: "posicion" });
    const b = await service
      .from("catalogo_abreviaturas")
      .insert({ ...base, abrev: "DELX", tipo: "ruido" });
    const c = await service
      .from("catalogo_abreviaturas")
      .insert({ ...base, abrev: "DELX", tipo: "ruido" });
    await service.from("catalogo_abreviaturas").delete().eq("abrev", "DELX");
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(c.error).not.toBeNull();
  });

  test("una confianza media sin confirmar no es activa; confirmada sí", async () => {
    const fila = { abrev: "ZZMEDIA", expansion: "zeta", tipo: "pieza", ambito: "ambos" };
    await service.from("catalogo_abreviaturas").insert({ ...fila, confianza: "media" });
    const antes = await service
      .from("catalogo_abreviaturas")
      .select("activo")
      .eq("abrev", "ZZMEDIA")
      .single();
    await service.from("catalogo_abreviaturas").update({ confirmado: true }).eq("abrev", "ZZMEDIA");
    const despues = await service
      .from("catalogo_abreviaturas")
      .select("activo")
      .eq("abrev", "ZZMEDIA")
      .single();
    await service.from("catalogo_abreviaturas").delete().eq("abrev", "ZZMEDIA");
    expect(antes.data?.activo).toBe(false);
    expect(despues.data?.activo).toBe(true);
  });

  test("el vendedor lee ambas tablas pero no escribe", async () => {
    const a = await vendedor.from("catalogo_abreviaturas").select("abrev");
    expect(a.error).toBeNull();
    expect(a.data?.length).toBe(ABREVIATURAS.length);
    const g = await vendedor.from("catalogo_grupos_excluidos").select("grupo");
    expect(g.error).toBeNull();
    expect((g.data ?? []).map((r) => r.grupo)).toContain("REPUESTO EMG");

    const ins = await vendedor
      .from("catalogo_abreviaturas")
      .insert({ abrev: "ZZ", expansion: "z", tipo: "pieza", ambito: "ambos", confianza: "alta" });
    expect(ins.error).not.toBeNull();
    const insG = await vendedor.from("catalogo_grupos_excluidos").insert({ grupo: "ZZ" });
    expect(insG.error).not.toBeNull();
    // Update y delete bloqueados por RLS no dan error: afectan 0 filas.
    const upd = await vendedor
      .from("catalogo_abreviaturas")
      .update({ expansion: "hackeado" })
      .eq("abrev", "AMORTIG")
      .select();
    expect(upd.data ?? []).toEqual([]);
    const del = await vendedor
      .from("catalogo_grupos_excluidos")
      .delete()
      .eq("grupo", "OTROS")
      .select();
    expect(del.data ?? []).toEqual([]);
  });

  test("el admin escribe", async () => {
    const ins = await admin
      .from("catalogo_abreviaturas")
      .insert({
        abrev: "ZZADMIN",
        expansion: "z",
        tipo: "pieza",
        ambito: "ambos",
        confianza: "baja",
      })
      .select()
      .single();
    expect(ins.error).toBeNull();
    const del = await admin.from("catalogo_abreviaturas").delete().eq("abrev", "ZZADMIN");
    expect(del.error).toBeNull();

    const insG = await admin.from("catalogo_grupos_excluidos").insert({ grupo: "GRUPO ADMIN" });
    expect(insG.error).toBeNull();
    await admin.from("catalogo_grupos_excluidos").delete().eq("grupo", "GRUPO ADMIN");
  });

  test("anónimo no lee ni escribe", async () => {
    const a = await anon.from("catalogo_abreviaturas").select("abrev");
    expect(a.error !== null || (a.data ?? []).length === 0).toBe(true);
    const g = await anon.from("catalogo_grupos_excluidos").select("grupo");
    expect(g.error !== null || (g.data ?? []).length === 0).toBe(true);
    const ins = await anon
      .from("catalogo_abreviaturas")
      .insert({ abrev: "ZZ", expansion: "z", tipo: "pieza", ambito: "ambos", confianza: "alta" });
    expect(ins.error).not.toBeNull();
  });
});
