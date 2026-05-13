import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import type { ProductoInsert } from "@/server/repositories/productos.repo";

function productoFixture(overrides: Partial<ProductoInsert> = {}): ProductoInsert {
  return {
    codigo_interno: "PAS-001",
    sku_proveedor: null,
    nombre: "Pastilla freno delantera",
    descripcion: null,
    categoria: "frenos",
    compatibilidad: [{ marca: "Toyota", modelo: "Corolla", anio_desde: 2010, anio_hasta: 2020 }],
    precio: 50,
    stock: 10,
    imagen_url: null,
    activo: true,
    ...overrides,
  };
}

describe("CatalogMatcherService.buscar", () => {
  let repo: InMemoryProductsRepository;
  let svc: DefaultCatalogMatcherService;

  beforeEach(() => {
    repo = new InMemoryProductsRepository();
    svc = new DefaultCatalogMatcherService(repo);
  });

  test("match exacto codigo_interno coloca producto primero", async () => {
    await repo.create(productoFixture({ codigo_interno: "PAS-001", nombre: "Pastilla freno" }));
    await repo.create(productoFixture({ codigo_interno: "DIS-002", nombre: "PAS-001 similar" }));

    const result = await svc.buscar({ query: "PAS-001" });

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].codigo_interno).toBe("PAS-001");
    expect(result.count).toBe(2);
  });

  test("match parcial nombre case-insensitive", async () => {
    await repo.create(
      productoFixture({ codigo_interno: "X-1", nombre: "Pastilla freno delantera" }),
    );
    await repo.create(productoFixture({ codigo_interno: "X-2", nombre: "Disco rotor" }));

    const result = await svc.buscar({ query: "pastilla" });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].codigo_interno).toBe("X-1");
  });

  test("excluye productos inactivos", async () => {
    await repo.create(productoFixture({ codigo_interno: "ACT-1", nombre: "Pastilla activa" }));
    await repo.create(
      productoFixture({ codigo_interno: "INA-1", nombre: "Pastilla inactiva", activo: false }),
    );

    const result = await svc.buscar({ query: "pastilla" });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].codigo_interno).toBe("ACT-1");
  });

  test("filtra por compatibilidad marca+modelo+anio", async () => {
    await repo.create(
      productoFixture({
        codigo_interno: "TOY-COR",
        nombre: "Pastilla Corolla",
        compatibilidad: [
          { marca: "Toyota", modelo: "Corolla", anio_desde: 2015, anio_hasta: 2020 },
        ],
      }),
    );
    await repo.create(
      productoFixture({
        codigo_interno: "FOR-FOC",
        nombre: "Pastilla Focus",
        compatibilidad: [{ marca: "Ford", modelo: "Focus", anio_desde: 2010, anio_hasta: 2018 }],
      }),
    );

    const result = await svc.buscar({
      query: "pastilla",
      marca: "toyota",
      modelo: "corolla",
      anio: 2018,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].codigo_interno).toBe("TOY-COR");
  });

  test("anio fuera de rango excluye producto", async () => {
    await repo.create(
      productoFixture({
        codigo_interno: "TOY-COR",
        nombre: "Pastilla Corolla",
        compatibilidad: [
          { marca: "Toyota", modelo: "Corolla", anio_desde: 2015, anio_hasta: 2020 },
        ],
      }),
    );

    const result = await svc.buscar({
      query: "pastilla",
      marca: "Toyota",
      modelo: "Corolla",
      anio: 2025,
    });

    expect(result.matches).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  test("sin filtros vehiculo busca en todo el catalogo activo", async () => {
    await repo.create(productoFixture({ codigo_interno: "A-1", nombre: "Pastilla A" }));
    await repo.create(productoFixture({ codigo_interno: "A-2", nombre: "Pastilla B" }));

    const result = await svc.buscar({ query: "pastilla" });

    expect(result.matches).toHaveLength(2);
  });

  test("ningun match retorna lista vacia con count 0", async () => {
    await repo.create(productoFixture({ codigo_interno: "X-1", nombre: "Disco rotor" }));

    const result = await svc.buscar({ query: "amortiguador" });

    expect(result.matches).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("output expone solo campos del schema (sin descripcion ni compatibilidad)", async () => {
    await repo.create(
      productoFixture({
        codigo_interno: "P-1",
        nombre: "Pastilla",
        descripcion: "interno desc",
        precio: 99.5,
        stock: 5,
      }),
    );

    const result = await svc.buscar({ query: "pastilla" });

    const match = result.matches[0];
    expect(Object.keys(match).sort()).toEqual([
      "codigo_interno",
      "id",
      "nombre",
      "precio",
      "stock",
    ]);
    expect(match.precio).toBe(99.5);
    expect(match.stock).toBe(5);
  });

  test("scoring: codigo exacto > prefix nombre > contains nombre", async () => {
    await repo.create(productoFixture({ codigo_interno: "freno-rear", nombre: "Otro" }));
    await repo.create(productoFixture({ codigo_interno: "X-1", nombre: "freno trasero" }));
    await repo.create(
      productoFixture({ codigo_interno: "X-2", nombre: "Pastilla con freno integrado" }),
    );

    const result = await svc.buscar({ query: "freno" });

    expect(result.matches).toHaveLength(3);
    expect(result.matches[0].codigo_interno).toBe("freno-rear");
    expect(result.matches[1].codigo_interno).toBe("X-1");
    expect(result.matches[2].codigo_interno).toBe("X-2");
  });

  test("filtro solo marca sin modelo ni anio", async () => {
    await repo.create(
      productoFixture({
        codigo_interno: "TOY-1",
        nombre: "Pastilla",
        compatibilidad: [{ marca: "Toyota", modelo: "Hilux", anio_desde: 2010, anio_hasta: 2020 }],
      }),
    );
    await repo.create(
      productoFixture({
        codigo_interno: "FOR-1",
        nombre: "Pastilla",
        compatibilidad: [{ marca: "Ford", modelo: "Ranger", anio_desde: 2010, anio_hasta: 2020 }],
      }),
    );

    const result = await svc.buscar({ query: "pastilla", marca: "toyota" });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].codigo_interno).toBe("TOY-1");
  });
});
