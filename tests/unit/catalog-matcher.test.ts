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

/**
 * El catálogo real: un export de inventario sin columna de compatibilidad,
 * con el vehículo dentro del nombre y el tipo de repuesto en la categoría.
 *
 * Los dos casos de acá son los que hicieron que el agente respondiera "no
 * tenemos radiadores para el Aveo" con 65 unidades en el depósito, durante la
 * primera conversación real por WhatsApp.
 */
describe("catálogo real: sin compatibilidad cargada", () => {
  let repo: InMemoryProductsRepository;
  let svc: DefaultCatalogMatcherService;

  beforeEach(() => {
    repo = new InMemoryProductsRepository();
    svc = new DefaultCatalogMatcherService(repo);
  });

  const comoElExport = (over: Partial<ProductoInsert> = {}) =>
    repo.create(
      productoFixture({
        // Así llega del Excel: sin compatibilidad, el auto en el nombre.
        compatibilidad: [],
        ...over,
      }),
    );

  test("un producto sin compatibilidad NO se descarta al preguntar por marca", async () => {
    // `[].some()` es siempre false: filtrar por ahí escondía el catálogo entero
    // apenas el agente mencionaba una marca.
    await comoElExport({
      codigo_interno: "CRKD-10 96535300",
      nombre: "CH TAX AVEO",
      categoria: "AXIAL DE DIRECCION",
      stock: 65,
    });

    const r = await svc.buscar({ query: "aveo", marca: "Chevrolet", modelo: "Aveo" });
    expect(r.count).toBe(1);
    expect(r.matches[0]?.codigo_interno).toBe("CRKD-10 96535300");
  });

  test("se encuentra por categoría: el tipo de repuesto no está en el nombre", async () => {
    // Quien pregunta "axial de dirección" no escribe ninguna palabra del
    // nombre, porque ahí va el auto y no la pieza.
    await comoElExport({
      codigo_interno: "9042063/CH",
      nombre: "CH SAIL 1.4 12-",
      categoria: "AXIAL DE DIRECCION",
      stock: 111,
    });

    const r = await svc.buscar({ query: "axial de direccion" });
    expect(r.count).toBe(1);
    expect(r.matches[0]?.stock).toBe(111);
  });

  test("una compatibilidad cargada de verdad sigue filtrando", async () => {
    // El arreglo no desactiva el filtro: solo deja pasar lo que no sabe.
    await repo.create(
      productoFixture({
        codigo_interno: "SOLO-FORD",
        nombre: "Amortiguador",
        compatibilidad: [{ marca: "Ford", modelo: "Focus", anio_desde: 2010, anio_hasta: 2020 }],
      }),
    );

    const r = await svc.buscar({ query: "amortiguador", marca: "Toyota" });
    expect(r.count).toBe(0);
  });
});

/**
 * Cómo pregunta un cliente de verdad.
 *
 * Nadie escribe "96817344/CH": escribe "radiador del aveo". El tipo de repuesto
 * y el auto viven en columnas distintas, así que buscar la frase entera dentro
 * de cada una daba cero.
 */
describe("frases naturales del cliente", () => {
  let repo: InMemoryProductsRepository;
  let svc: DefaultCatalogMatcherService;

  beforeEach(async () => {
    repo = new InMemoryProductsRepository();
    svc = new DefaultCatalogMatcherService(repo);
    const real = (over: Partial<ProductoInsert>) =>
      repo.create(productoFixture({ compatibilidad: [], ...over }));

    await real({
      codigo_interno: "96817344/CH",
      nombre: "CH AVEO 1.6 05- TAX 09- FAMILY 44.3*70.8",
      categoria: "RADIADOR",
      descripcion: "KOREA",
      stock: 444,
      precio: 37.13,
    });
    await real({
      codigo_interno: "96536532/K",
      nombre: "CH AVEO 1.4 1.6 SUP (L)",
      categoria: "MANG RADIADOR",
      descripcion: "KOREA",
      stock: 52,
    });
    await real({
      codigo_interno: "RAD-SPARK",
      nombre: "CH SPARK 06-",
      categoria: "RADIADOR",
      descripcion: "CHINA",
      stock: 20,
    });
  });

  test("«radiador del aveo» encuentra y pone primero el del Aveo", async () => {
    const r = await svc.buscar({ query: "radiador del aveo" });
    expect(r.count).toBeGreaterThan(0);
    // Acierta las dos palabras; el del Spark solo acierta "radiador".
    expect(r.matches[0]?.codigo_interno).toBe("96817344/CH");
  });

  test("«busco un radiador para el aveo» ignora el relleno", async () => {
    const r = await svc.buscar({ query: "busco un radiador para el aveo" });
    expect(r.matches[0]?.codigo_interno).toBe("96817344/CH");
  });

  test("las tildes no importan", async () => {
    // El catálogo escribe DIRECCION sin tilde y el cliente con tilde.
    await repo.create(
      productoFixture({
        compatibilidad: [],
        codigo_interno: "MZC-2540",
        nombre: "MZ ALEG RH 00-",
        categoria: "AXIAL DE DIRECCION",
      }),
    );
    const r = await svc.buscar({ query: "axial de dirección para mazda alegro" });
    expect(r.matches.some((m) => m.codigo_interno === "MZC-2540")).toBe(true);
  });

  test("se encuentra por la marca del fabricante, que vive en la descripción", async () => {
    const r = await svc.buscar({ query: "radiador korea" });
    expect(r.matches.some((m) => m.codigo_interno === "96817344/CH")).toBe(true);
  });

  test("el código exacto sigue ganando sobre cualquier frase", async () => {
    const r = await svc.buscar({ query: "96817344/CH" });
    expect(r.matches[0]?.codigo_interno).toBe("96817344/CH");
  });
});
