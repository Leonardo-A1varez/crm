import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/types.gen";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

// La carga del catálogo del ERP (Oracle) contra Postgres real: las tres RPC que
// llama el extractor de Bodega Web con la clave anon, la compuerta de la clave
// y lo que puede o no puede hacer cada rol. Contrato: docs/integraciones/erp-oracle-contrato-crm.md.

type Authed = SupabaseClient<Database>;
type FilaErp = Record<string, unknown>;

const PASSWORD = "erp-sync-2026!secret";
const EMAILS = {
  admin: "erp-sync-admin@crm.local",
  vendedor: "erp-sync-vendedor@crm.local",
} as const;

// La clave del test: 32 bytes al azar por corrida, igual que la real.
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

/** Una fila con la forma del contrato. Por defecto, la fila 7 real del CSV del ERP. */
function fila(over: FilaErp = {}): FilaErp {
  return {
    no_item: "7",
    codigo: "AU0826-1LL",
    otros_codigos: "43210-8H300",
    n_grupo: "162",
    grupo: "RULIMANES RD/RP",
    descripcion: "NS XTRAIL 2.0 4*2 T30 QR20 RP",
    descripcion_auxiliar: "38*79*45 NTN",
    existencias_total: 0,
    precio_matriz: null,
    precio_magdalena: 40.5,
    precio_koreanos: 12.29,
    precio_sas_repuestos: null,
    codigo_difiere: "si",
    ...over,
  };
}

async function cargar(filas: unknown, clave = CLAVE, tabla = "productos") {
  return anon.rpc("erp_sync_cargar", { p_clave: clave, p_tabla: tabla, p_filas: filas as never });
}

async function borrar(claves: unknown, clave = CLAVE, tabla = "productos") {
  return anon.rpc("erp_sync_borrar", { p_clave: clave, p_tabla: tabla, p_claves: claves as never });
}

async function producto(codigo: string) {
  const { data, error } = await service
    .from("productos")
    .select("*")
    .eq("codigo_interno", codigo)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function contarProductos(): Promise<number> {
  const { count, error } = await service
    .from("productos")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
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

describe("compuerta: clave, tabla y tamaño del lote", () => {
  test("clave equivocada → 42501 y no cambia nada", async () => {
    const r = await cargar([fila()], CLAVE_MALA);
    expect(r.error?.code).toBe("42501");
    expect(await contarProductos()).toBe(0);

    const b = await borrar([{ no_item: "7" }], CLAVE_MALA);
    expect(b.error?.code).toBe("42501");

    const e = await anon.rpc("erp_sync_estado_fijar", { p_clave: CLAVE_MALA, p_fase: "inicio" });
    expect(e.error?.code).toBe("42501");
  });

  test("clave nula, vacía o corta → 42501", async () => {
    for (const clave of [null, "", "corta"]) {
      const r = await cargar([fila()], clave as unknown as string);
      expect(r.error?.code).toBe("42501");
    }
    expect(await contarProductos()).toBe(0);
  });

  test("el mensaje de error no repite la clave", async () => {
    const r = await cargar([fila()], CLAVE_MALA);
    const texto = JSON.stringify(r.error);
    expect(texto).not.toContain(CLAVE_MALA);
    expect(texto).not.toContain(CLAVE);
  });

  test("la clave se valida antes que la tabla: tabla rara con clave mala → 42501", async () => {
    const r = await cargar([fila()], CLAVE_MALA, "usuarios");
    expect(r.error?.code).toBe("42501");
  });

  test("tabla fuera de la lista → 22023", async () => {
    for (const tabla of ["usuarios", "leads", "erp_productos", "PRODUCTOS", ""]) {
      const r = await cargar([fila()], CLAVE, tabla);
      expect(r.error?.code).toBe("22023");
      const b = await borrar([{ no_item: "7" }], CLAVE, tabla);
      expect(b.error?.code).toBe("22023");
    }
    expect(await contarProductos()).toBe(0);
  });

  test("más de 5000 filas → 54000", async () => {
    const filas = Array.from({ length: 5001 }, (_, i) => fila({ no_item: String(i + 1) }));
    const r = await cargar(filas);
    expect(r.error?.code).toBe("54000");
    expect(await contarProductos()).toBe(0);
  });

  test("el lote tiene que ser un arreglo → 22023", async () => {
    const r = await cargar({ no_item: "7" });
    expect(r.error?.code).toBe("22023");
  });

  test("lote vacío → 0", async () => {
    const r = await cargar([]);
    expect(r.error).toBeNull();
    expect(r.data).toBe(0);
  });
});

describe("validación de filas: un error rechaza el lote entero", () => {
  const malas: Array<[string, FilaErp]> = [
    ["no_item numérico", fila({ no_item: 7 })],
    ["no_item vacío", fila({ no_item: "  " })],
    ["sin descripcion", fila({ descripcion: undefined })],
    ["descripcion vacía", fila({ descripcion: "" })],
    ["existencias como texto", fila({ existencias_total: "15" })],
    ["existencias negativas", fila({ existencias_total: -1 })],
    ["precio como texto", fila({ precio_matriz: "5.74" })],
    ["precio negativo", fila({ precio_koreanos: -0.01 })],
    ["precio gigante", fila({ precio_matriz: 1e12 })],
    ["codigo_difiere raro", fila({ codigo_difiere: "tal vez" })],
    ["campo desconocido", fila({ costo: 1 })],
    ["codigo numérico", fila({ codigo: 12 })],
  ];

  test.each(malas)("%s → 22023 y no entra ninguna fila", async (_n, mala) => {
    const buena = fila({ no_item: "1" });
    const r = await cargar([buena, mala]);
    expect(r.error?.code).toBe("22023");
    expect(r.error?.message).toMatch(/fila 2/);
    expect(await contarProductos()).toBe(0);
  });

  test("un elemento que no es objeto → 22023", async () => {
    const r = await cargar([fila(), "7"]);
    expect(r.error?.code).toBe("22023");
    expect(await contarProductos()).toBe(0);
  });

  test("no_item repetido en el mismo lote → 22023", async () => {
    const r = await cargar([fila(), fila({ descripcion: "OTRA" })]);
    expect(r.error?.code).toBe("22023");
    expect(r.error?.message).toMatch(/repetido/);
    expect(await contarProductos()).toBe(0);
  });
});

describe("carga de productos", () => {
  test("mapea cada columna del ERP a la del CRM", async () => {
    const r = await cargar([
      fila({
        otros_codigos: "13028-ED000/15041-ED000 SZC-519/USA  .....",
        existencias_total: 19.5,
        grupo: "RULIMANES RD/RP ",
      }),
    ]);
    expect(r.error).toBeNull();
    expect(r.data).toBe(1);

    const p = await producto("7");
    expect(p).toMatchObject({
      codigo_interno: "7",
      codigo_fabrica: "AU0826-1LL",
      otros_codigos: ["13028-ED000", "15041-ED000", "SZC-519/USA"],
      categoria: "RULIMANES RD/RP",
      nombre: "NS XTRAIL 2.0 4*2 T30 QR20 RP",
      descripcion: "38*79*45 NTN",
      // Existencias fraccionarias (juegos partidos): se cuenta la unidad entera.
      stock: 19,
      precio_matriz: null,
      precio_magdalena: 40.5,
      precio_koreanos: 12.29,
      precio_sas_repuestos: null,
      codigo_difiere: true,
      activo: true,
      compatibilidad_pendiente: true,
    });
    expect(p?.erp_actualizado_at).not.toBeNull();
  });

  test("vacíos y blancos quedan en null, precios con más de 2 decimales se redondean", async () => {
    await cargar([
      fila({
        codigo: " ",
        otros_codigos: "",
        grupo: null,
        descripcion_auxiliar: "",
        precio_matriz: 22.5542857142857,
        codigo_difiere: "no",
      }),
    ]);
    const p = await producto("7");
    expect(p).toMatchObject({
      codigo_fabrica: null,
      otros_codigos: [],
      categoria: null,
      descripcion: null,
      precio_matriz: 22.55,
      codigo_difiere: false,
    });
  });

  test("precio = SAS si es > 0, si no Matriz, si no Koreanos y después Magdalena", async () => {
    await cargar([
      fila({
        no_item: "20",
        precio_matriz: 9,
        precio_magdalena: 3,
        precio_koreanos: 4,
        precio_sas_repuestos: 0,
      }),
      fila({
        no_item: "21",
        precio_matriz: null,
        precio_magdalena: 3,
        precio_koreanos: 4,
        precio_sas_repuestos: null,
      }),
      fila({
        no_item: "22",
        precio_matriz: 0,
        precio_magdalena: 3,
        precio_koreanos: 0,
        precio_sas_repuestos: null,
      }),
      fila({
        no_item: "23",
        precio_matriz: 9,
        precio_magdalena: 3,
        precio_koreanos: 4,
        precio_sas_repuestos: 7.5,
      }),
    ]);
    expect((await producto("20"))?.precio).toBe(9);
    expect((await producto("21"))?.precio).toBe(4);
    expect((await producto("22"))?.precio).toBe(3);
    expect((await producto("23"))?.precio).toBe(7.5);
  });

  test("precio: con SAS gana SAS; sin ningún precio > 0 queda null", async () => {
    await cargar([
      fila({
        no_item: "1",
        precio_matriz: 5.74,
        precio_magdalena: 5.95,
        precio_koreanos: 5.79,
        precio_sas_repuestos: 2.61,
      }),
      fila({
        no_item: "12",
        precio_matriz: 6,
        precio_magdalena: 0,
        precio_koreanos: 5.04,
        precio_sas_repuestos: 6,
      }),
      fila({
        no_item: "13",
        precio_matriz: 0,
        precio_magdalena: 0,
        precio_koreanos: 0,
        precio_sas_repuestos: 0,
      }),
      fila({
        no_item: "14",
        precio_matriz: null,
        precio_magdalena: null,
        precio_koreanos: null,
        precio_sas_repuestos: null,
      }),
      fila({
        no_item: "6",
        precio_matriz: 15.29,
        precio_magdalena: null,
        precio_koreanos: null,
        precio_sas_repuestos: null,
      }),
    ]);
    expect((await producto("1"))?.precio).toBe(2.61);
    expect((await producto("12"))?.precio).toBe(6);
    expect((await producto("13"))?.precio).toBeNull();
    expect((await producto("14"))?.precio).toBeNull();
    expect((await producto("6"))?.precio).toBe(15.29);
  });

  test("recargar el mismo lote es idempotente y no toca updated_at", async () => {
    const lote = [fila({ no_item: "1" }), fila({ no_item: "2" })];
    const r1 = await cargar(lote);
    expect(r1.data).toBe(2);
    const antes = await producto("1");

    const r2 = await cargar(lote);
    expect(r2.error).toBeNull();
    expect(r2.data).toBe(0);
    const despues = await producto("1");
    expect(despues?.updated_at).toBe(antes?.updated_at);
    expect(despues?.erp_actualizado_at).toBe(antes?.erp_actualizado_at);
    expect(await contarProductos()).toBe(2);
  });

  test("un cambio de stock actualiza solo esa fila", async () => {
    await cargar([fila({ no_item: "1" }), fila({ no_item: "2" })]);
    const antes2 = await producto("2");
    const r = await cargar([fila({ no_item: "1", existencias_total: 3 }), fila({ no_item: "2" })]);
    expect(r.data).toBe(1);
    expect((await producto("1"))?.stock).toBe(3);
    expect((await producto("2"))?.updated_at).toBe(antes2?.updated_at);
  });

  test("compatibilidad_pendiente: se prende al insertar y al cambiar el nombre, no por otra cosa", async () => {
    await cargar([fila()]);
    expect((await producto("7"))?.compatibilidad_pendiente).toBe(true);

    // El proceso de compatibilidad la apaga después de traducir el nombre.
    const { error } = await service
      .from("productos")
      .update({ compatibilidad_pendiente: false })
      .eq("codigo_interno", "7");
    expect(error).toBeNull();

    await cargar([fila({ existencias_total: 8, precio_koreanos: 13 })]);
    expect((await producto("7"))?.compatibilidad_pendiente).toBe(false);

    await cargar([fila({ descripcion: "NS XTRAIL 2.5 T31 QR25 RP" })]);
    expect((await producto("7"))?.compatibilidad_pendiente).toBe(true);
  });

  test("no pisa lo que el ERP no trae: compatibilidad, imagen, sku", async () => {
    await cargar([fila()]);
    await service
      .from("productos")
      .update({ sku_proveedor: "SKU-1", imagen_url: "https://x.test/a.png" })
      .eq("codigo_interno", "7");
    await cargar([fila({ existencias_total: 4 })]);
    expect(await producto("7")).toMatchObject({
      sku_proveedor: "SKU-1",
      imagen_url: "https://x.test/a.png",
      stock: 4,
    });
  });

  test("actualiza una fila que ya existía cargada a mano (codigo_interno = no_item)", async () => {
    const { error } = await service.from("productos").insert({
      codigo_interno: "7",
      nombre: "VIEJO",
      precio: 9,
      stock: 1,
    });
    expect(error).toBeNull();
    const r = await cargar([fila()]);
    expect(r.data).toBe(1);
    expect(await producto("7")).toMatchObject({ nombre: fila().descripcion, precio: 12.29 });
    expect(await contarProductos()).toBe(1);
  });
});

describe("baja: borrar marca inactivo, nunca borra", () => {
  test("borrar marca activo=false y recargar reactiva", async () => {
    await cargar([fila({ no_item: "1" }), fila({ no_item: "2" })]);
    const b = await borrar([{ no_item: "1" }, { no_item: "999" }]);
    expect(b.error).toBeNull();
    expect(b.data).toBe(1);
    expect((await producto("1"))?.activo).toBe(false);
    expect((await producto("2"))?.activo).toBe(true);
    expect(await contarProductos()).toBe(2);

    // Borrar dos veces no vuelve a tocar la fila.
    const b2 = await borrar([{ no_item: "1" }]);
    expect(b2.data).toBe(0);

    const r = await cargar([fila({ no_item: "1" })]);
    expect(r.data).toBe(1);
    expect((await producto("1"))?.activo).toBe(true);
  });

  test("clave mal formada en borrar → 22023 y no toca nada", async () => {
    await cargar([fila({ no_item: "1" })]);
    for (const claves of [[{ no_item: 1 }], ["1"], [{ codigo: "1" }]]) {
      const b = await borrar(claves);
      expect(b.error?.code).toBe("22023");
    }
    expect((await producto("1"))?.activo).toBe(true);
  });

  test("más de 5000 claves → 54000", async () => {
    const claves = Array.from({ length: 5001 }, (_, i) => ({ no_item: String(i) }));
    const b = await borrar(claves);
    expect(b.error?.code).toBe("54000");
  });
});

describe("estado de la sincronización", () => {
  test("inicio y fin con éxito; fin con error guarda el error sin la clave", async () => {
    let r = await anon.rpc("erp_sync_estado_fijar", { p_clave: CLAVE, p_fase: "inicio" });
    expect(r.error).toBeNull();
    r = await anon.rpc("erp_sync_estado_fijar", {
      p_clave: CLAVE,
      p_fase: "fin",
      p_ok: true,
      p_filas_cargadas: 27187,
    });
    expect(r.error).toBeNull();

    const { data: ok } = await vendedor.from("erp_sync_estado").select("*").single();
    expect(ok).toMatchObject({ ultimo_ok: true, ultimo_error: null, filas_cargadas: 27187 });
    expect(ok?.ultimo_exito).not.toBeNull();
    expect(ok?.ultimo_inicio).not.toBeNull();

    r = await anon.rpc("erp_sync_estado_fijar", {
      p_clave: CLAVE,
      p_fase: "fin",
      p_ok: false,
      p_error: `Oracle caído; clave=${CLAVE}`,
    });
    expect(r.error).toBeNull();
    const { data: mal } = await admin.from("erp_sync_estado").select("*").single();
    expect(mal?.ultimo_ok).toBe(false);
    expect(mal?.ultimo_exito).toBe(ok?.ultimo_exito);
    expect(mal?.ultimo_error).toContain("Oracle caído");
    expect(mal?.ultimo_error).not.toContain(CLAVE);
  });

  test("fase desconocida → 22023", async () => {
    const r = await anon.rpc("erp_sync_estado_fijar", { p_clave: CLAVE, p_fase: "medio" });
    expect(r.error?.code).toBe("22023");
  });
});

describe("permisos por rol", () => {
  test("anon no lee la configuración privada ni el estado", async () => {
    const priv = await anon
      .schema("private" as never)
      .from("erp_sync_config" as never)
      .select("*");
    expect(priv.error).not.toBeNull();
    expect(priv.data).toBeNull();

    const est = await anon.from("erp_sync_estado").select("*");
    expect(est.data ?? []).toEqual([]);
  });

  test("anon no escribe productos ni el estado directo", async () => {
    await cargar([fila()]);
    const ins = await anon
      .from("productos")
      .insert({ codigo_interno: "X", nombre: "X", precio: 1 });
    expect(ins.error).not.toBeNull();
    await anon.from("productos").update({ stock: 99 }).eq("codigo_interno", "7");
    expect((await producto("7"))?.stock).toBe(0);
    const est = await anon.from("erp_sync_estado").update({ ultimo_error: "x" }).eq("id", 1);
    expect(est.error).not.toBeNull();
  });

  test("anon ni authenticated pueden fijar la clave", async () => {
    const hash = createHash("sha256").update("x".repeat(40)).digest("hex");
    for (const c of [anon, vendedor, admin]) {
      const r = await c.rpc("erp_sync_clave_fijar", { p_clave_hash: hash });
      expect(r.error).not.toBeNull();
    }
    // La clave sigue siendo la del test.
    expect((await cargar([fila()])).error).toBeNull();
  });

  test("authenticated no ejecuta las RPC de carga", async () => {
    const r = await vendedor.rpc("erp_sync_cargar", {
      p_clave: CLAVE,
      p_tabla: "productos",
      p_filas: [fila()] as never,
    });
    expect(r.error).not.toBeNull();
    expect(await contarProductos()).toBe(0);
  });

  test("vendedor lee el estado pero no lo escribe", async () => {
    const { data, error } = await vendedor.from("erp_sync_estado").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: 1 }]);
    const u = await vendedor.from("erp_sync_estado").update({ ultimo_error: "x" }).eq("id", 1);
    expect(u.error).not.toBeNull();
  });

  test("vendedor lee los cuatro precios del producto", async () => {
    await cargar([fila()]);
    const { data, error } = await vendedor
      .from("productos")
      .select(
        "precio, precio_matriz, precio_magdalena, precio_koreanos, precio_sas_repuestos, codigo_difiere",
      )
      .eq("codigo_interno", "7")
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ precio: 12.29, precio_magdalena: 40.5, codigo_difiere: true });
  });
});

describe("productos_listar con las columnas del ERP", () => {
  type Item = Record<string, unknown> & { codigo_interno: string };
  async function listar(cliente: Authed, campo: string, dir: "asc" | "desc") {
    const { data, error } = await cliente.rpc("productos_listar", {
      p_filtros: {},
      p_orden: [{ campo, dir }],
    });
    expect(error).toBeNull();
    return (data as { items: Item[] }).items;
  }

  test.each(["precio_matriz", "precio_magdalena", "precio_koreanos", "precio_sas_repuestos"])(
    "ordena por %s, con los null al final en las dos direcciones",
    async (campo) => {
      await cargar([
        fila({ no_item: "1", [campo]: 5 }),
        fila({ no_item: "2", [campo]: null }),
        fila({ no_item: "3", [campo]: 30 }),
        fila({ no_item: "4", [campo]: 0 }),
      ]);
      const asc = await listar(vendedor, campo, "asc");
      const desc = await listar(vendedor, campo, "desc");
      expect(asc.map((i) => i.codigo_interno)).toEqual(["4", "1", "3", "2"]);
      expect(desc.map((i) => i.codigo_interno)).toEqual(["3", "1", "4", "2"]);
    },
  );

  test("precio a consultar va al final en las dos direcciones", async () => {
    await cargar([
      fila({ no_item: "1", precio_koreanos: 9, precio_magdalena: null }),
      fila({ no_item: "2", precio_koreanos: null, precio_magdalena: null }),
      fila({ no_item: "3", precio_koreanos: 20, precio_magdalena: null }),
    ]);
    expect((await listar(vendedor, "precio", "asc")).map((i) => i.codigo_interno)).toEqual([
      "1",
      "3",
      "2",
    ]);
    expect((await listar(vendedor, "precio", "desc")).map((i) => i.codigo_interno)).toEqual([
      "3",
      "1",
      "2",
    ]);
  });

  test("cada item trae los cuatro precios, codigo_difiere y erp_actualizado_at", async () => {
    await cargar([fila()]);
    const [item] = await listar(admin, "codigo", "asc");
    expect(item).toMatchObject({
      codigo_interno: "7",
      precio: 12.29,
      precio_matriz: null,
      precio_magdalena: 40.5,
      precio_koreanos: 12.29,
      precio_sas_repuestos: null,
      codigo_difiere: true,
    });
    expect(typeof item?.["erp_actualizado_at"]).toBe("string");
  });
});

describe("usuarios.empresa_erp", () => {
  test("admin la fija; un valor fuera de 1/3/5/6 se rechaza; vendedor no puede", async () => {
    const vendedorId = userIds[1]!;
    const ok = await admin
      .from("usuarios")
      .update({ empresa_erp: 6 })
      .eq("id", vendedorId)
      .select("empresa_erp")
      .single();
    expect(ok.error).toBeNull();
    expect(ok.data?.empresa_erp).toBe(6);

    const malo = await admin.from("usuarios").update({ empresa_erp: 2 }).eq("id", vendedorId);
    expect(malo.error?.code).toBe("23514");

    const v = await vendedor
      .from("usuarios")
      .update({ empresa_erp: 1 })
      .eq("id", vendedorId)
      .select("empresa_erp");
    expect(v.error !== null || (v.data ?? []).length === 0).toBe(true);
    const { data } = await service
      .from("usuarios")
      .select("empresa_erp")
      .eq("id", vendedorId)
      .single();
    expect(data?.empresa_erp).toBe(6);
  });

  test("admin no puede cambiar el rol ni el email por esta vía", async () => {
    const vendedorId = userIds[1]!;
    const r = await admin.from("usuarios").update({ rol: "admin" }).eq("id", vendedorId);
    expect(r.error).not.toBeNull();
    const { data } = await service.from("usuarios").select("rol").eq("id", vendedorId).single();
    expect(data?.rol).toBe("vendedor");
  });
});

describe("XELIM: los items marcados para eliminar quedan inactivos", () => {
  test("una descripcion_auxiliar que empieza con XELIM carga inactiva", async () => {
    const r = await cargar([
      fila({ no_item: "1", descripcion_auxiliar: "XELIM" }),
      fila({ no_item: "2", descripcion_auxiliar: "  xelim delphi" }),
      fila({ no_item: "3", descripcion_auxiliar: "MOBIS" }),
    ]);
    expect(r.error).toBeNull();
    expect((await producto("1"))?.activo).toBe(false);
    expect((await producto("2"))?.activo).toBe(false);
    expect((await producto("3"))?.activo).toBe(true);
  });

  test("recargar un XELIM lo mantiene inactivo", async () => {
    await cargar([fila({ no_item: "1", descripcion_auxiliar: "XELIM" })]);
    const r = await cargar([
      fila({ no_item: "1", descripcion_auxiliar: "XELIM", existencias_total: 5 }),
    ]);
    expect(r.error).toBeNull();
    expect(await producto("1")).toMatchObject({ activo: false, stock: 5 });
  });

  test("un item normal dado de baja se reactiva al recargar, como antes", async () => {
    await cargar([fila({ no_item: "1" })]);
    await borrar([{ no_item: "1" }]);
    expect((await producto("1"))?.activo).toBe(false);
    await cargar([fila({ no_item: "1" })]);
    expect((await producto("1"))?.activo).toBe(true);
  });

  test("si el ERP le quita el XELIM, vuelve a activo", async () => {
    await cargar([fila({ no_item: "1", descripcion_auxiliar: "XELIM" })]);
    await cargar([fila({ no_item: "1", descripcion_auxiliar: "MOBIS" })]);
    expect((await producto("1"))?.activo).toBe(true);
  });
});
