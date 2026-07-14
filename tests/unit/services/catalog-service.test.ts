import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { DefaultCatalogService } from "@/server/services/catalog/default-catalog.service";
import type { ProductoInsert } from "@/server/repositories/productos.repo";

function baseInsert(overrides: Partial<ProductoInsert> = {}): ProductoInsert {
  return {
    codigo_interno: "PF-001",
    sku_proveedor: null,
    nombre: "Pastilla freno",
    descripcion: null,
    categoria: "frenos",
    compatibilidad: [],
    precio: 100,
    stock: 5,
    imagen_url: null,
    activo: true,
    ...overrides,
  };
}

describe("DefaultCatalogService.listProductos", () => {
  let repo: InMemoryProductsRepository;
  let svc: DefaultCatalogService;

  beforeEach(() => {
    repo = new InMemoryProductsRepository();
    svc = new DefaultCatalogService({ productos: repo });
  });

  test("delega al repo y devuelve orden del repo (nombre asc)", async () => {
    await repo.create(baseInsert({ codigo_interno: "B", nombre: "Zapata" }));
    await repo.create(baseInsert({ codigo_interno: "A", nombre: "Amortiguador" }));
    const r = await svc.listProductos();
    expect(r.map((p) => p.nombre)).toEqual(["Amortiguador", "Zapata"]);
  });

  test("filtra por q trimmeado (nombre o codigo)", async () => {
    await repo.create(baseInsert({ codigo_interno: "FA-99", nombre: "Filtro aire" }));
    await repo.create(baseInsert({ codigo_interno: "PA-01", nombre: "Pastilla" }));
    const r = await svc.listProductos({ q: "  filtro  " });
    expect(r).toHaveLength(1);
    expect(r[0]?.codigo_interno).toBe("FA-99");
  });

  test("q vacío o whitespace = sin filtro", async () => {
    await repo.create(baseInsert());
    const r = await svc.listProductos({ q: "   " });
    expect(r).toHaveLength(1);
  });

  test("incluye inactivos (baja lógica visible en catálogo)", async () => {
    await repo.create(baseInsert({ codigo_interno: "IN-1", activo: false }));
    const r = await svc.listProductos();
    expect(r).toHaveLength(1);
    expect(r[0]?.activo).toBe(false);
  });
});
