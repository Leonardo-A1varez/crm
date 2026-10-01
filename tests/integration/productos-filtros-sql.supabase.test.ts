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

async function listar(filtros: unknown) {
  const { data, error } = await client.rpc("productos_listar", {
    p_filtros: filtros as never,
    p_pagina: 1,
    p_por_pagina: 50,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { total: number; items: { codigo_interno: string }[] };
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
    const { error } = await client.rpc("productos_facetas", {
      p_filtros: filtros as never,
      p_limite: 10,
    });
    expect(error).toBeNull();
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

    const { data, error: e2 } = await client.rpc("productos_facetas", {
      p_filtros: {} as never,
      p_limite: 100,
    });
    expect(e2).toBeNull();
    const marcas = (data ?? []).filter((f) => f.columna === "marca").map((f) => f.valor);
    const categorias = (data ?? []).filter((f) => f.columna === "categoria").map((f) => f.valor);

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
    const { error } = await client.rpc("productos_facetas", {
      p_filtros: filtros as never,
      p_limite: 10,
    });
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

  test("las facetas heredan q: cuentan solo los productos que coinciden", async () => {
    const { data, error } = await client.rpc("productos_facetas", {
      p_filtros: { q: "uno" } as never,
      p_limite: 10,
    });
    expect(error).toBeNull();
    const filas = (data ?? []).map((f) => `${f.columna}:${f.valor}:${f.cantidad}`).sort();
    expect(filas).toEqual(["categoria:FRENOS:1", "marca:MOBIS:1"]);
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
