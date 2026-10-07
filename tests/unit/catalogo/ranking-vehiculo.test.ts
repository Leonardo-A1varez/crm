import { describe, expect, test } from "vitest";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { MODELOS } from "../../helpers/catalogo-compat-fixtures";
import {
  CONSULTA_ACCENT_2006,
  ESCALONES_ESPERADOS,
  TERMOSTATOS_REALES,
} from "../../helpers/catalogo-ranking-fixtures";

async function repoConTermostatos(): Promise<InMemoryProductsRepository> {
  const repo = new InMemoryProductsRepository({ modelos: MODELOS });
  for (const p of TERMOSTATOS_REALES) {
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
  return repo;
}

describe("ranking por vehículo (conversación real: termostato para el Accent 1.6, 2006)", () => {
  test("lo que declara el vehículo va antes que lo de otra variante, que lo que no declara nada y que lo que declara otra cilindrada", async () => {
    const repo = await repoConTermostatos();
    const hits = await repo.search({ ...CONSULTA_ACCENT_2006 });
    expect(hits).toHaveLength(TERMOSTATOS_REALES.length);

    // Se parte la lista en escalones por código y se compara cada escalón como
    // conjunto: el orden adentro de uno lo deciden puntaje y existencia.
    const orden = hits.map((h) => h.codigo_interno);
    let desde = 0;
    for (const escalon of ESCALONES_ESPERADOS) {
      const tramo = orden.slice(desde, desde + escalon.length);
      expect([...tramo].sort()).toEqual([...escalon].sort());
      desde += escalon.length;
    }
  });

  test("las coincidencias exactas de cilindrada quedan arriba aunque el termostato suelto tenga más existencia", async () => {
    const repo = await repoConTermostatos();
    const hits = await repo.search({ ...CONSULTA_ACCENT_2006 });
    const primeros = hits.slice(0, 6).map((h) => h.codigo_interno);
    expect(primeros).not.toContain("9028");
    expect(primeros).not.toContain("12249");
    expect(
      hits.slice(0, 6).every((h) => h.compatibilidad.some((e) => e.cilindrada === "1.6")),
    ).toBe(true);
  });

  test("el Accent 1.4 que solo entra por la Verna queda al final, debajo de las filas sin compatibilidad", async () => {
    const repo = await repoConTermostatos();
    const hits = await repo.search({ ...CONSULTA_ACCENT_2006 });
    const posicion = (c: string) => hits.findIndex((h) => h.codigo_interno === c);
    for (const contradice of ["12249", "22223", "13671", "18261"]) {
      for (const sinDato of ["25530", "11068", "10134", "14566"]) {
        expect(posicion(contradice)).toBeGreaterThan(posicion(sinDato));
      }
    }
  });

  test("no se descarta ninguna fila: las sin compatibilidad siguen en el resultado", async () => {
    const repo = await repoConTermostatos();
    const hits = await repo.search({ ...CONSULTA_ACCENT_2006 });
    const codigos = hits.map((h) => h.codigo_interno);
    for (const c of ["25530", "11068", "10134", "14566", "12249"]) expect(codigos).toContain(c);
  });

  test.each([
    ["19309", 7],
    ["9028", 5],
    ["24570", 4],
    ["12088", 0],
    ["25530", -1],
    ["12249", -2],
  ])("nivel_vehiculo de %s = %i", async (codigo, nivel) => {
    const repo = await repoConTermostatos();
    const hits = await repo.search({ ...CONSULTA_ACCENT_2006 });
    expect(hits.find((h) => h.codigo_interno === codigo)?.nivel_vehiculo).toBe(nivel);
  });

  test("sin año ni cilindrada pedidos, lo que se declara de más no suma", async () => {
    const repo = await repoConTermostatos();
    const hits = await repo.search({
      q: "termostato",
      marca: "Hyundai",
      modelo: "Accent",
      tope: 50,
    });
    const nivel = (c: string) => hits.find((h) => h.codigo_interno === c)?.nivel_vehiculo;
    // Accent exacto: 4, pase lo que pase con año y cilindrada.
    expect(nivel("19309")).toBe(4);
    expect(nivel("9028")).toBe(4);
    expect(nivel("24570")).toBe(4);
    // Solo la Verna: no es el modelo pedido.
    expect(nivel("12088")).toBe(0);
    // Sin compatibilidad: no sabemos.
    expect(nivel("25530")).toBe(-1);
  });

  test("sin vehículo no hay escalones: todos valen 0 y manda el puntaje", async () => {
    const repo = await repoConTermostatos();
    const hits = await repo.search({ q: "termostato", tope: 50 });
    expect(new Set(hits.map((h) => h.nivel_vehiculo))).toEqual(new Set([0]));
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.puntaje).toBeGreaterThanOrEqual(hits[i]!.puntaje);
    }
  });
});
