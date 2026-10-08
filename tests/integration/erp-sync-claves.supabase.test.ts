import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/types.gen";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

// `erp_sync_claves`: el extractor de Bodega Web pide las claves (`codigo_interno`) de
// los productos ACTIVOS que vinieron del ERP para reconciliar bajas contra Oracle.
// Contrato: docs/integraciones/erp-oracle-contrato-crm.md §4.1.

type Authed = SupabaseClient<Database>;
interface Pagina {
  claves: string[];
  siguiente: string | null;
}

const PASSWORD = "erp-claves-2026!secret";
const EMAILS = {
  admin: "erp-claves-admin@crm.local",
  vendedor: "erp-claves-vendedor@crm.local",
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

async function cargarErp(noItems: string[]): Promise<void> {
  const filas = noItems.map((no_item) => ({
    no_item,
    descripcion: `PIEZA ${no_item}`,
    existencias_total: 1,
  }));
  const { error } = await anon.rpc("erp_sync_cargar", {
    p_clave: CLAVE,
    p_tabla: "productos",
    p_filas: filas as never,
  });
  if (error) throw new Error(`erp_sync_cargar: ${error.message}`);
}

async function bajaErp(noItems: string[]): Promise<void> {
  const { error } = await anon.rpc("erp_sync_borrar", {
    p_clave: CLAVE,
    p_tabla: "productos",
    p_claves: noItems.map((no_item) => ({ no_item })) as never,
  });
  if (error) throw new Error(`erp_sync_borrar: ${error.message}`);
}

/** Alta manual, como el formulario o el import CSV: sin `erp_actualizado_at`. */
async function altaManual(codigo: string): Promise<void> {
  const { error } = await service
    .from("productos")
    .insert({ codigo_interno: codigo, nombre: `MANUAL ${codigo}`, precio: 1 });
  if (error) throw new Error(`alta manual: ${error.message}`);
}

async function claves(args: {
  clave?: string | null;
  tabla?: string;
  despues?: string | null;
  limite?: number | null;
  cliente?: Authed;
}) {
  const params: Record<string, unknown> = {
    // `in` y no `??`: el test de clave nula tiene que mandar null de verdad.
    p_clave: "clave" in args ? args.clave : CLAVE,
    p_tabla: args.tabla ?? "productos",
  };
  if (args.despues !== undefined) params["p_despues"] = args.despues;
  if (args.limite !== undefined) params["p_limite"] = args.limite;
  return (args.cliente ?? anon).rpc("erp_sync_claves", params as never);
}

async function pagina(despues: string | null, limite: number): Promise<Pagina> {
  const r = await claves({ despues, limite });
  if (r.error) throw new Error(`erp_sync_claves: ${r.error.code} ${r.error.message}`);
  return r.data as unknown as Pagina;
}

/** Recorre todas las páginas como lo haría el extractor. */
async function recorrer(limite: number): Promise<{ todas: string[]; paginas: number }> {
  const todas: string[] = [];
  let despues: string | null = null;
  let paginas = 0;
  for (;;) {
    const p = await pagina(despues, limite);
    paginas += 1;
    todas.push(...p.claves);
    if (p.siguiente === null) break;
    expect(p.siguiente).toBe(p.claves[p.claves.length - 1]);
    despues = p.siguiente;
    if (paginas > 100) throw new Error("paginación sin fin");
  }
  return { todas, paginas };
}

/** Orden por bytes: lo que compara el extractor. Con ASCII coincide con el de JS. */
function ordenBytes(xs: string[]): string[] {
  return [...xs].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
}

async function limpiarProductos(): Promise<void> {
  const { error } = await service
    .from("productos")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
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
  await limpiarProductos();
});

afterAll(async () => {
  await cleanupTestDb(service);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
});

describe("compuerta: clave, tabla y límite", () => {
  test("clave equivocada → 42501 sin datos ni la clave en el error", async () => {
    await cargarErp(["7"]);
    const r = await claves({ clave: CLAVE_MALA });
    expect(r.error?.code).toBe("42501");
    expect(r.data).toBeNull();
    const texto = JSON.stringify(r.error);
    expect(texto).not.toContain(CLAVE_MALA);
    expect(texto).not.toContain(CLAVE);
    expect(texto).not.toContain('"7"');
  });

  test("clave nula, vacía o corta → 42501", async () => {
    for (const clave of [null, "", "corta"]) {
      const r = await claves({ clave });
      expect(r.error?.code).toBe("42501");
    }
  });

  test("la clave se valida antes que la tabla y el límite", async () => {
    const r = await claves({ clave: CLAVE_MALA, tabla: "usuarios", limite: 0 });
    expect(r.error?.code).toBe("42501");
  });

  test("tabla fuera de la lista → 22023", async () => {
    for (const tabla of ["usuarios", "marcas", "PRODUCTOS", ""]) {
      const r = await claves({ tabla });
      expect(r.error?.code).toBe("22023");
    }
  });

  test("límite 0, negativo o nulo → 22023", async () => {
    for (const limite of [0, -1, null]) {
      const r = await claves({ limite });
      expect(r.error?.code).toBe("22023");
    }
  });

  test("límite 5001 → 54000; 5000 y 1 se aceptan", async () => {
    expect((await claves({ limite: 5001 })).error?.code).toBe("54000");
    expect((await claves({ limite: 5000 })).error).toBeNull();
    expect((await claves({ limite: 1 })).error).toBeNull();
  });

  test("p_despues de más de 256 caracteres → 22023", async () => {
    const r = await claves({ despues: "x".repeat(257) });
    expect(r.error?.code).toBe("22023");
  });
});

describe("qué claves devuelve", () => {
  test("sin productos: claves vacías y siguiente null", async () => {
    const r = await claves({});
    expect(r.error).toBeNull();
    expect(r.data).toEqual({ claves: [], siguiente: null });
  });

  test("solo activos del ERP: excluye los dados de baja y los cargados a mano", async () => {
    await cargarErp(["10", "11", "12", "13"]);
    await bajaErp(["11"]);
    await altaManual("M-1");
    await altaManual("M-2");
    // XELIM: lo carga el ERP pero queda inactivo.
    const { error } = await anon.rpc("erp_sync_cargar", {
      p_clave: CLAVE,
      p_tabla: "productos",
      p_filas: [{ no_item: "14", descripcion: "XELIM", existencias_total: 0 }] as never,
    });
    expect(error).toBeNull();

    const p = await pagina(null, 5000);
    expect(p.claves).toEqual(["10", "12", "13"]);
    expect(p.siguiente).toBeNull();
  });

  test("un producto manual que después carga el ERP pasa a contar", async () => {
    await altaManual("20");
    expect((await pagina(null, 5000)).claves).toEqual([]);
    await cargarErp(["20"]);
    expect((await pagina(null, 5000)).claves).toEqual(["20"]);
  });

  test("editar a mano un producto manual no lo vuelve del ERP", async () => {
    await altaManual("M-3");
    const { error } = await admin
      .from("productos")
      .update({ stock: 5, nombre: "MANUAL EDITADO" })
      .eq("codigo_interno", "M-3");
    expect(error).toBeNull();
    expect((await pagina(null, 5000)).claves).toEqual([]);
  });
});

describe("paginación por clave, en orden de bytes", () => {
  // Claves que ordenan distinto por bytes que por idioma: `-`, dígitos, mayúsculas,
  // minúsculas; y números como texto ("100" < "9").
  const CLAVES = [
    "9",
    "100",
    "10",
    "1",
    "B-2",
    "a-1",
    "Z",
    "z",
    "-X",
    "_y",
    "0001",
    "A",
    "b",
    "99",
    "ABC/1",
    "abc.2",
    "7",
    "70",
    "700",
    "8",
  ];

  test("recorre más de una página sin duplicados ni faltantes, ordenado por bytes", async () => {
    await cargarErp(CLAVES);
    await altaManual("M-9");
    await cargarErp(["X-BAJA"]);
    await bajaErp(["X-BAJA"]);

    const { todas, paginas } = await recorrer(6);
    expect(paginas).toBe(4); // 6 + 6 + 6 + 2
    expect(todas).toEqual(ordenBytes(CLAVES));
    expect(new Set(todas).size).toBe(CLAVES.length);
  });

  test("página llena justo al final: siguiente no es null y la próxima viene vacía", async () => {
    await cargarErp(CLAVES);
    const { todas, paginas } = await recorrer(5);
    expect(paginas).toBe(5); // 4 llenas + 1 vacía
    expect(todas).toEqual(ordenBytes(CLAVES));
  });

  test("el orden es estable entre llamadas y p_despues no tiene que existir", async () => {
    await cargarErp(CLAVES);
    const a = await pagina(null, 5000);
    const b = await pagina(null, 5000);
    expect(b).toEqual(a);

    // "50" no es una clave: arranca en la primera mayor por bytes ("7").
    const p = await pagina("50", 3);
    expect(p.claves).toEqual(["7", "70", "700"]);
    expect(p.siguiente).toBe("700");
  });
});

describe("permisos por rol", () => {
  test("authenticated (vendedor y admin) no ejecuta erp_sync_claves ni con la clave", async () => {
    await cargarErp(["7"]);
    for (const c of [vendedor, admin]) {
      const r = await claves({ cliente: c });
      expect(r.error).not.toBeNull();
      expect(r.data).toBeNull();
    }
  });

  test("anon con la clave sí", async () => {
    await cargarErp(["7"]);
    const r = await claves({});
    expect(r.error).toBeNull();
    expect(r.data).toEqual({ claves: ["7"], siguiente: null });
  });

  test("service_role la ejecuta (con la clave)", async () => {
    await cargarErp(["7"]);
    const r = await service.rpc("erp_sync_claves", { p_clave: CLAVE, p_tabla: "productos" });
    expect(r.error).toBeNull();
    expect(r.data).toEqual({ claves: ["7"], siguiente: null });
  });
});
