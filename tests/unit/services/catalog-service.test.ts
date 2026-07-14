import { beforeEach, describe, expect, test } from "vitest";
import { ConflictError, NotFoundError } from "@/lib/errors";
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

describe("DefaultCatalogService CRUD", () => {
  let repo: InMemoryProductsRepository;
  let svc: DefaultCatalogService;

  beforeEach(() => {
    repo = new InMemoryProductsRepository();
    svc = new DefaultCatalogService({ productos: repo });
  });

  test("createProducto aplica defaults no-form (activo true, compatibilidad [], imagen null)", async () => {
    const p = await svc.createProducto({
      codigo_interno: "N-1",
      nombre: "Nuevo",
      descripcion: null,
      categoria: null,
      sku_proveedor: null,
      precio: 10,
      stock: 1,
    });
    expect(p.activo).toBe(true);
    expect(p.compatibilidad).toEqual([]);
    expect(p.imagen_url).toBeNull();
  });

  test("createProducto propaga ConflictError por codigo duplicado", async () => {
    await repo.create(baseInsert({ codigo_interno: "DUP-1" }));
    await expect(
      svc.createProducto({
        codigo_interno: "DUP-1",
        nombre: "Otro",
        descripcion: null,
        categoria: null,
        sku_proveedor: null,
        precio: 1,
        stock: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("updateProducto parchea sin tocar codigo_interno ni activo", async () => {
    const p = await repo.create(baseInsert({ codigo_interno: "U-1", activo: false }));
    const r = await svc.updateProducto(p.id, {
      nombre: "Editado",
      descripcion: "desc",
      categoria: null,
      sku_proveedor: null,
      precio: 999,
      stock: 7,
    });
    expect(r.nombre).toBe("Editado");
    expect(r.precio).toBe(999);
    expect(r.codigo_interno).toBe("U-1");
    expect(r.activo).toBe(false);
  });

  test("updateProducto id inexistente → NotFoundError", async () => {
    await expect(
      svc.updateProducto(crypto.randomUUID(), {
        nombre: "x",
        descripcion: null,
        categoria: null,
        sku_proveedor: null,
        precio: 1,
        stock: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("setProductoActivo togglea", async () => {
    const p = await repo.create(baseInsert({ codigo_interno: "T-1", activo: true }));
    const r = await svc.setProductoActivo(p.id, false);
    expect(r.activo).toBe(false);
  });
});
