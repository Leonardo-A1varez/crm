import { describe, expect, test } from "vitest";
import { filtrarPorCategoria, nivelDeCategoria, palabrasDePieza } from "@/lib/catalogo/categoria";
import { normalizarCilindrada } from "@/lib/catalogo/compatibilidad";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { armarSalida } from "@/server/services/catalog-matcher.service";
import { BOMBA_DE_AGUA_RIO_18 } from "../../helpers/catalogo-bomba-agua-fixtures";
import { MODELOS } from "../../helpers/catalogo-compat-fixtures";

async function buscar(q: string) {
  const repo = new InMemoryProductsRepository({ modelos: MODELOS });
  for (const p of BOMBA_DE_AGUA_RIO_18) {
    await repo.create({
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
  const hits = await repo.search({ q, marca: "Kia", modelo: "Rio", anio: 2018, tope: 20 });
  const consulta = { query: q, marca: "Kia", modelo: "Rio" };
  return { hits, consulta };
}

describe("palabrasDePieza", () => {
  test("quita calificadores y las palabras del vehículo", () => {
    expect(
      palabrasDePieza({ query: "bomba de agua completa", marca: "Kia", modelo: "Rio" }),
    ).toEqual(["bomba", "agua"]);
    expect(palabrasDePieza({ query: "termostato accent 1.6", modelo: "Accent" })).toEqual([
      "termostato",
      "1.6",
    ]);
  });
});

describe("nivelDeCategoria", () => {
  const c = { query: "bomba de agua", marca: "Kia", modelo: "Rio" };
  test("la categoría que ES lo pedido, la que lo contiene, la que lo roza y la que no", () => {
    expect(nivelDeCategoria("BOMBA DE AGUA", c)).toBe(3);
    expect(nivelDeCategoria("POLEA BOMBA AGUA E HIDRAU", c)).toBe(2);
    expect(nivelDeCategoria("MANG PASO AGUA", c)).toBe(1);
    expect(nivelDeCategoria("BOMBA COMPLETA COMBUST INYEC", c)).toBe(1);
    expect(nivelDeCategoria("MANG RADIADOR", c)).toBe(0);
  });
  test("con una sola palabra útil, o sin categoría, no hay nada que comparar", () => {
    expect(nivelDeCategoria("MANG RADIADOR", { query: "radiador" })).toBeNull();
    expect(nivelDeCategoria(null, c)).toBeNull();
  });
});

describe("conversación real: 'una bomba de agua para el Rio 18'", () => {
  test("turno 1: ofrece solo la bomba y la polea, sin mangueras ni bomba de combustible", async () => {
    const { hits, consulta } = await buscar("bomba de agua");
    const out = armarSalida(hits, { anio: 2018 }, consulta);
    expect(out.diferencias?.atributos).toContain("pieza");
    expect([...(out.diferencias?.valores.pieza ?? [])].sort()).toEqual([
      "BOMBA DE AGUA",
      "POLEA BOMBA AGUA E HIDRAU",
    ]);
    expect(out.count).toBe(5);
  });

  test("turno 2: 'bomba de agua completa' queda en una sola pieza, sin repreguntar", async () => {
    const { hits, consulta } = await buscar("bomba de agua completa");
    const out = armarSalida(hits, { anio: 2018 }, consulta);
    expect(out.matches.every((m) => m.pieza === undefined)).toBe(true);
    expect(out.matches.map((m) => m.codigo_interno).sort()).toEqual(["13973", "21688", "21693"]);
    expect(out.diferencias?.atributos ?? []).not.toContain("pieza");
    expect(out.diferencias?.procedencias).toEqual(["JUNGWOO", "MOBIS"]);
    expect(out.diferencias?.instruccion).toMatch(/cotiz/i);
    expect(out.diferencias?.instruccion).not.toMatch(/Preguntale/);
  });

  test("el ranking pone la categoría completa antes que la que solo roza una palabra", async () => {
    const { hits } = await buscar("bomba de agua");
    const primeras = hits.slice(0, 5).map((h) => h.categoria);
    expect(primeras.every((c) => c === "BOMBA DE AGUA" || c === "POLEA BOMBA AGUA E HIDRAU")).toBe(
      true,
    );
  });
});

describe("filtrarPorCategoria", () => {
  test("si ninguna categoría contiene la frase, no descarta nada", () => {
    const hits = [{ categoria: "MANG PASO AGUA" }, { categoria: "BOMBA COMPLETA COMBUST INYEC" }];
    expect(filtrarPorCategoria(hits, { query: "bomba de agua" })).toEqual(hits);
  });
});

describe("cilindrada vacía", () => {
  test("'' es 'no lo dijo'", () => {
    expect(normalizarCilindrada("")).toBeUndefined();
  });
});
