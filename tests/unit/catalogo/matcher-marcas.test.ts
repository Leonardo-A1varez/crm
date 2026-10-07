import { beforeEach, describe, expect, test, vi } from "vitest";
import type { MarcaCatalogo } from "@/lib/catalogo/procedencia";
import type { Logger } from "@/lib/observability/logger";
import type { CatalogoMarcasRepository } from "@/server/repositories/catalogo-marcas.repo";
import { InMemoryCatalogoMarcasRepository } from "@/server/repositories/catalogo-marcas.repo";
import {
  InMemoryProductsRepository,
  type ProductoInsert,
} from "@/server/repositories/productos.repo";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { MARCAS } from "../../helpers/catalogo-marcas-fixtures";

const producto = (o: Partial<ProductoInsert>): ProductoInsert => ({
  codigo_interno: "X",
  sku_proveedor: null,
  nombre: "BOMBA DE AGUA KIA RIO 18-",
  descripcion: null,
  categoria: "BOMBA DE AGUA",
  compatibilidad: [],
  precio: 10,
  stock: 5,
  imagen_url: null,
  activo: true,
  ...o,
});

describe("buscar_repuesto: marca y procedencia por la tabla de marcas", () => {
  let productos: InMemoryProductsRepository;

  beforeEach(async () => {
    productos = new InMemoryProductsRepository();
    await productos.create(
      producto({ codigo_interno: "B-1", descripcion: "MOBIS", precio: 96.66 }),
    );
    await productos.create(
      producto({ codigo_interno: "B-2", descripcion: "JUNGWOO", precio: 21.51 }),
    );
  });

  test("cada candidato trae su marca y su procedencia; las opciones se ofrecen con el formato", async () => {
    const svc = new DefaultCatalogMatcherService(
      productos,
      new InMemoryCatalogoMarcasRepository(MARCAS),
    );
    const r = await svc.buscar({ query: "bomba de agua" });

    const por = (c: string) => r.matches.find((m) => m.codigo_interno === c);
    expect(por("B-1")).toMatchObject({ marca: "MOBIS", procedencia: "Original", precio: 96.66 });
    expect(por("B-2")).toMatchObject({ marca: "JUNGWOO", procedencia: "Korea", precio: 21.51 });
    expect(r.diferencias?.procedencias).toEqual(["MOBIS (Original)", "JUNGWOO (Korea)"]);
    expect(r.diferencias?.instruccion).toContain("MARCA (Procedencia) $precio");
  });

  test("las marcas inactivas no cuentan", async () => {
    const svc = new DefaultCatalogMatcherService(
      productos,
      new InMemoryCatalogoMarcasRepository([
        { nombre: "MOBIS", tipo: null, procedencia: "ORIGINAL", activa: false, alias: [] },
      ]),
    );
    const r = await svc.buscar({ query: "bomba de agua" });
    const mobis = r.matches.find((m) => m.codigo_interno === "B-1");
    expect(mobis?.marca).toBe("MOBIS");
    expect(mobis?.procedencia).toBeUndefined();
  });

  test("sin repositorio de marcas, la marca sale sin procedencia: nada se inventa", async () => {
    const r = await new DefaultCatalogMatcherService(productos).buscar({ query: "bomba de agua" });
    for (const m of r.matches) {
      expect(m.marca).toBeDefined();
      expect(m.procedencia).toBeUndefined();
    }
  });

  test("si la tabla de marcas no se puede leer, el agente sigue cotizando y se avisa en el log", async () => {
    const warn = vi.fn();
    const logger = { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as Logger;
    const roto: CatalogoMarcasRepository = {
      listarActivas: () => Promise.reject(new Error("relation catalogo_marcas does not exist")),
    };
    const r = await new DefaultCatalogMatcherService(productos, roto, logger).buscar({
      query: "bomba de agua",
    });
    expect(r.count).toBe(2);
    expect(r.matches.map((m) => m.marca).sort()).toEqual(["JUNGWOO", "MOBIS"]);
    expect(r.matches.every((m) => m.procedencia === undefined)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("InMemoryCatalogoMarcasRepository", () => {
  test("devuelve solo las activas y copias de los alias", async () => {
    const origen: MarcaCatalogo[] = [
      { nombre: "A", tipo: null, procedencia: null, activa: true, alias: ["a1"] },
      { nombre: "B", tipo: null, procedencia: null, activa: false, alias: [] },
    ];
    const lista = await new InMemoryCatalogoMarcasRepository(origen).listarActivas();
    expect(lista.map((m) => m.nombre)).toEqual(["A"]);
    expect(lista[0]?.alias).not.toBe(origen[0]?.alias);
  });
});
