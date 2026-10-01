import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { normalizarValor } from "@/lib/catalogo/normalizar-valor";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

// Casos que solo existen en la frontera SQL: lo que llega a las funciones sin
// pasar por el schema Zod (otro cliente de la RPC, un jsonb mal formado) y la
// paridad exacta del `btrim` con `normalizarValor`.

let client: TestClient;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
});

beforeEach(async () => {
  await cleanupTestDb(client);
  const { error } = await client.from("productos").insert([
    { codigo_interno: "S-1", nombre: "Uno", categoria: "FRENOS", descripcion: "MOBIS", precio: 1 },
    { codigo_interno: "S-2", nombre: "Dos", categoria: "FILTRO", descripcion: "GM", precio: 2 },
  ]);
  if (error) throw new Error(`seed: ${error.message}`);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

async function listar(filtros: unknown, orden: unknown = []) {
  const { data, error } = await client.rpc("productos_listar", {
    p_filtros: filtros as never,
    p_orden: orden as never,
    p_desde: 0,
    p_cantidad: 1000,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { total: number; items: { codigo_interno: string }[] };
}

async function faceta(filtros: unknown, columna: string, busqueda?: string) {
  return client.rpc("productos_faceta", {
    p_filtros: filtros as never,
    p_columna: columna,
    p_limite: 100,
    p_busqueda: busqueda,
  });
}

describe("productos_filtrados / listar / facetas: frontera SQL", () => {
  test.each([
    ["categorias escalar", { categorias: "FRENOS" }],
    ["sin_categorias número", { sin_categorias: 5 }],
    ["marcas objeto", { marcas: { a: 1 } }],
    ["sin_marcas null", { sin_marcas: null }],
    ["filtros null", null],
    ["filtros array", []],
    ["filtros vacío", {}],
  ])("una lista que no es array o un filtro nulo se ignora sin romper: %s", async (_n, filtros) => {
    const r = await listar(filtros);
    expect(r.total).toBe(2);
    for (const columna of ["codigo", "codigo_fabrica", "otros_codigos", "categoria", "marca"]) {
      const { error } = await faceta(filtros, columna);
      expect(error).toBeNull();
    }
  });

  test("los cinco espacios de los bordes se quitan y los demás no: igual que normalizarValor", async () => {
    // Cada fila lleva en la marca un borde distinto; la normalización de TS decide
    // cuáles deben colapsar a "X" y cuáles quedan como valor propio.
    const bordes = ["\t", "\r", "\n", " ", " ", " ", "\f", "\v", "﻿"];
    const filas = bordes.map((b, i) => ({
      codigo_interno: `B-${i}`,
      nombre: `Borde ${i}`,
      categoria: `${b}CAT${b}`,
      descripcion: `${b}X${b}`,
      precio: 1,
    }));
    const { error } = await client.from("productos").insert(filas);
    expect(error).toBeNull();

    const rMarcas = await faceta({}, "marca");
    const rCategorias = await faceta({}, "categoria");
    expect(rMarcas.error).toBeNull();
    expect(rCategorias.error).toBeNull();
    const marcas = (rMarcas.data ?? []).map((f) => f.valor);
    const categorias = (rCategorias.data ?? []).map((f) => f.valor);

    const esperadas = new Set(bordes.map((b) => normalizarValor(`${b}X${b}`)));
    expect(new Set(marcas.filter((m) => m.includes("X")))).toEqual(esperadas);
    const esperadasCat = new Set(bordes.map((b) => normalizarValor(`${b}CAT${b}`)));
    expect(new Set(categorias.filter((c) => c.includes("CAT")))).toEqual(esperadasCat);

    // Y cada valor que devuelve la faceta, tal cual, vuelve a encontrar sus filas.
    for (const valor of esperadas) {
      const r = await listar({ marcas: [valor] });
      expect(r.total).toBeGreaterThan(0);
    }
  });

  test.each([
    ["número", { q: 5 }],
    ["array", { q: ["a"] }],
    ["objeto", { q: { a: 1 } }],
    ["null", { q: null }],
    ["vacío", { q: "" }],
    ["solo espacios", { q: " \t\n " }],
  ])("q con un tipo raro o vacío no rompe la consulta: %s", async (_n, filtros) => {
    const r = await listar(filtros);
    expect(typeof r.total).toBe("number");
    const { error } = await faceta(filtros, "marca");
    expect(error).toBeNull();
  });

  test("q vacío o en blanco es sin filtro; q con texto filtra y la barra invertida es literal", async () => {
    const { error } = await client.from("productos").insert([
      { codigo_interno: "BS\\1", nombre: "Con barra", precio: 1, otros_codigos: [] },
      { codigo_interno: "OTRO-9", nombre: "Sin barra", precio: 1, otros_codigos: ["ALT\\7"] },
    ]);
    expect(error).toBeNull();
    expect((await listar({ q: "  " })).total).toBe(4);
    expect((await listar({ q: "\\" })).items.map((p) => p.codigo_interno).sort()).toEqual([
      "BS\\1",
      "OTRO-9",
    ]);
    expect((await listar({ q: "bs\\1" })).items.map((p) => p.codigo_interno)).toEqual(["BS\\1"]);
  });

  test.each([
    ["otro texto", "otro"],
    ["vacío", ""],
    ["mayúscula", "ACTIVO"],
    ["número", 1],
  ])("estado que no es 'activo' ni 'inactivo' se ignora: %s", async (_n, estado) => {
    expect((await listar({ estado })).total).toBe(2);
  });

  test("estado 'activo' e 'inactivo' siguen filtrando", async () => {
    await client.from("productos").update({ activo: false }).eq("codigo_interno", "S-2");
    expect((await listar({ estado: "activo" })).items.map((p) => p.codigo_interno)).toEqual([
      "S-1",
    ]);
    expect((await listar({ estado: "inactivo" })).items.map((p) => p.codigo_interno)).toEqual([
      "S-2",
    ]);
  });

  test("el listado no manda al navegador las columnas de índice", async () => {
    const r = await listar({});
    const claves = Object.keys(r.items[0] ?? {});
    expect(claves).not.toContain("busqueda");
    expect(claves).not.toContain("busqueda_general");
    expect(claves).not.toContain("codigo_fabrica_plegado");
    expect(claves).not.toContain("codigo_interno_plegado");
    expect(claves).toContain("codigo_interno");
  });

  test("productos_faceta rechaza una columna que no está en la lista blanca", async () => {
    for (const columna of ["precio", "stock", "x; drop table productos", ""]) {
      const { error } = await faceta({}, columna);
      expect(error, `columna ${columna}`).not.toBeNull();
    }
    const { error } = await client.rpc("productos_faceta", {
      p_filtros: {} as never,
      p_columna: null as never,
    });
    expect(error).not.toBeNull();
  });

  test("las listas de valores heredan q: cuentan solo los productos que coinciden", async () => {
    const marcas = await faceta({ q: "uno" }, "marca");
    const categorias = await faceta({ q: "uno" }, "categoria");
    expect(marcas.error).toBeNull();
    expect((marcas.data ?? []).map((f) => `${f.valor}:${f.cantidad}`)).toEqual(["MOBIS:1"]);
    expect((categorias.data ?? []).map((f) => `${f.valor}:${f.cantidad}`)).toEqual(["FRENOS:1"]);
  });

  test("el orden solo acepta campos de la lista blanca: un campo raro o un nivel de más no inyecta nada", async () => {
    const raro = await listar({}, [
      { campo: "nombre; drop table productos; --", dir: "asc" },
      { campo: "precio", dir: "desc; select 1" },
    ]);
    // El primero se ignora; el segundo vale con dirección ascendente (la única otra opción).
    expect(raro.items.map((p) => p.codigo_interno)).toEqual(["S-1", "S-2"]);
    const { count } = await client.from("productos").select("*", { count: "exact", head: true });
    expect(count).toBe(2);
    // Un p_orden que no es un array se ignora.
    expect((await listar({}, { campo: "precio" })).total).toBe(2);
    expect((await listar({}, null)).total).toBe(2);
  });

  test("p_cantidad se acota a 1..1000 y p_desde a 0", async () => {
    const { data, error } = await client.rpc("productos_listar", {
      p_filtros: {} as never,
      p_orden: [] as never,
      p_desde: -5,
      p_cantidad: 0,
    });
    expect(error).toBeNull();
    const r = data as unknown as { total: number; items: unknown[] };
    expect(r.total).toBe(2);
    expect(r.items).toHaveLength(1);
  });

  test("el orden numérico del código usa la columna generada", async () => {
    const { error } = await client.from("productos").insert([
      { codigo_interno: "10", nombre: "Diez", precio: 1 },
      { codigo_interno: "9", nombre: "Nueve", precio: 1 },
    ]);
    expect(error).toBeNull();
    const r = await listar({}, [{ campo: "codigo", dir: "asc" }]);
    expect(r.items.map((p) => p.codigo_interno)).toEqual(["9", "10", "S-1", "S-2"]);
    const { data } = await client
      .from("productos")
      .select("codigo_interno, codigo_interno_orden")
      .in("codigo_interno", ["10", "S-1"]);
    expect(
      Object.fromEntries((data ?? []).map((f) => [f.codigo_interno, f.codigo_interno_orden])),
    ).toEqual({
      "10": 10,
      "S-1": null,
    });
  });

  test("categoría vacía o en blanco aparece como (sin categoría) y se puede filtrar", async () => {
    const { error } = await client.from("productos").insert([
      { codigo_interno: "E-1", nombre: "Vacía", categoria: "", precio: 1 },
      { codigo_interno: "E-2", nombre: "Blanca", categoria: " \t ", precio: 1 },
    ]);
    expect(error).toBeNull();
    const r = await listar({ categorias: ["(sin categoría)"] });
    expect(r.items.map((p) => p.codigo_interno).sort()).toEqual(["E-1", "E-2"]);
  });
});
