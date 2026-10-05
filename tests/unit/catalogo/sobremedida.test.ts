import { describe, expect, test } from "vitest";
import { avisoSobremedida } from "@/lib/catalogo/sobremedida";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";

const hit = (nombre: string, categoria: string | null = null) => ({ nombre, categoria });

describe("avisoSobremedida", () => {
  test.each([
    ["PISTON HY ACCENT 1.6 STD", null],
    ["PISTONES CH AVEO 1.6 0.50", null],
    ["JUEGO CHAQUETAS KIA RIO", null],
    ["ANILLOS HY ACCENT 1.4 0.25", null],
    ["JUEGO DE ALGO", "PISTONES"],
    ["algo", "Chaquetas"],
    ["PISTÓN AVEO", null],
  ])("avisa para %j (categoría %j)", (nombre, categoria) => {
    expect(avisoSobremedida([hit(nombre, categoria)])).toMatch(/sobremedida/i);
  });

  test("el aviso dice qué hacer: no cotizar y preguntar si el motor fue rectificado", () => {
    const a = avisoSobremedida([hit("PISTON X")]);
    expect(a).toMatch(/no cotices/i);
    expect(a).toMatch(/rectificado/i);
  });

  test.each([
    "TERMOSTATO HY ACCENT 1.6",
    "RADIADOR CH AVEO",
    "PISTOLA DE PINTURA",
    "ANILLOSELLO", // no es la palabra suelta
  ])("no avisa para %j", (nombre) => {
    expect(avisoSobremedida([hit(nombre)])).toBeNull();
  });

  test("sin resultados no avisa", () => {
    expect(avisoSobremedida([])).toBeNull();
  });

  test("alcanza con que uno de los candidatos sea de motor", () => {
    expect(avisoSobremedida([hit("TERMOSTATO"), hit("PISTON X")])).not.toBeNull();
  });
});

describe("CatalogMatcherService.buscar: aviso de sobremedida", () => {
  test("lo agrega al resultado cuando hay pistones", async () => {
    const repo = new InMemoryProductsRepository();
    await repo.create({
      codigo_interno: "PIS-1",
      sku_proveedor: null,
      nombre: "PISTON HY ACCENT 1.6 STD",
      descripcion: null,
      categoria: "PISTONES",
      compatibilidad: [],
      precio: 60,
      stock: 2,
      imagen_url: null,
      activo: true,
    });
    const r = await new DefaultCatalogMatcherService(repo).buscar({ query: "piston" });
    expect(r.aviso).toMatch(/sobremedida/i);
  });

  test("no lo agrega para otras piezas", async () => {
    const repo = new InMemoryProductsRepository();
    await repo.create({
      codigo_interno: "TER-1",
      sku_proveedor: null,
      nombre: "TERMOSTATO HY ACCENT 1.6",
      descripcion: null,
      categoria: "TERMOSTATO",
      compatibilidad: [],
      precio: 12,
      stock: 2,
      imagen_url: null,
      activo: true,
    });
    const r = await new DefaultCatalogMatcherService(repo).buscar({ query: "termostato" });
    expect(r.aviso).toBeUndefined();
  });
});
