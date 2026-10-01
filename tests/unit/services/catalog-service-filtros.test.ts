import { beforeEach, describe, expect, test, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { SIN_MARCA } from "@/lib/validation/productos-filtros.schema";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { DefaultCatalogService } from "@/server/services/catalog/default-catalog.service";
import type { ProductoInsert } from "@/server/repositories/productos.repo";

function producto(overrides: Partial<ProductoInsert> = {}): ProductoInsert {
  return {
    codigo_interno: "P-1",
    sku_proveedor: null,
    nombre: "Radiador Aveo",
    descripcion: "MOBIS",
    categoria: "RADIADOR",
    compatibilidad: [],
    precio: 100,
    stock: 5,
    imagen_url: null,
    activo: true,
    ...overrides,
  };
}

describe("DefaultCatalogService.buscarProductos / facetasProductos", () => {
  let repo: InMemoryProductsRepository;
  let svc: DefaultCatalogService;

  beforeEach(async () => {
    repo = new InMemoryProductsRepository();
    svc = new DefaultCatalogService({ productos: repo });
    await repo.create(producto());
    await repo.create(
      producto({
        codigo_interno: "P-2",
        nombre: "Pastilla",
        categoria: "FRENOS",
        descripcion: null,
      }),
    );
  });

  test("acepta los parámetros de la URL como strings y devuelve la página con el total", async () => {
    const r = await svc.buscarProductos({
      codigo: "p-",
      categorias: "RADIADOR",
      precioMin: "50",
      pagina: "1",
    });
    expect(r.total).toBe(1);
    expect(r.items.map((p) => p.codigo_interno)).toEqual(["P-1"]);
    expect(r).toMatchObject({ pagina: 1, porPagina: 50 });
  });

  test("sin parámetros: página 1 de 50, todo el catálogo", async () => {
    const r = await svc.buscarProductos({});
    expect(r.total).toBe(2);
    expect(r.porPagina).toBe(50);
  });

  test("le pasa al repo los filtros ya normalizados", async () => {
    const espia = vi.spyOn(repo, "listarFiltrado");
    await svc.buscarProductos({ codigo: "  P-1  ", conStock: "1", marcas: [SIN_MARCA, "MOBIS"] });
    expect(espia).toHaveBeenCalledWith(
      expect.objectContaining({
        codigo: "P-1",
        conStock: true,
        marcas: [SIN_MARCA, "MOBIS"],
        pagina: 1,
        porPagina: 50,
      }),
    );
  });

  test("input inválido: ValidationError y el repo ni se entera", async () => {
    const espia = vi.spyOn(repo, "listarFiltrado");
    await expect(svc.buscarProductos({ porPagina: "101" })).rejects.toThrow(ValidationError);
    await expect(svc.buscarProductos({ precioMin: "-5" })).rejects.toThrow(ValidationError);
    expect(espia).not.toHaveBeenCalled();
  });

  test("facetas: límite por defecto 500, y los filtros ya normalizados", async () => {
    const espia = vi.spyOn(repo, "facetas");
    const f = await svc.facetasProductos({ categorias: "RADIADOR" });
    expect(espia).toHaveBeenCalledWith(
      expect.objectContaining({ categorias: ["RADIADOR"] }),
      expect.objectContaining({ limite: 500 }),
    );
    // La faceta de categorías ignora el filtro de categorías: trae las dos.
    expect(f.categorias.valores.map((v) => v.valor).sort()).toEqual(["FRENOS", "RADIADOR"]);
  });

  test("facetas: límite explícito", async () => {
    const espia = vi.spyOn(repo, "facetas");
    await svc.facetasProductos({}, { limite: 3000 });
    expect(espia).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limite: 3000 }),
    );
  });

  test("facetas: qMarca y qCategoria se normalizan y viajan al repo; en blanco no", async () => {
    const espia = vi.spyOn(repo, "facetas");
    await svc.facetasProductos({}, { qMarca: "  mob\u00a0", qCategoria: "   " });
    const opciones = espia.mock.calls[0]?.[1];
    expect(opciones?.qMarca).toBe("mob");
    expect(opciones?.qCategoria).toBeUndefined();
  });

  test("facetas: la búsqueda dentro de la lista llega hasta el resultado", async () => {
    const f = await svc.facetasProductos({}, { qMarca: "mob" });
    expect(f.marcas.valores).toEqual([{ valor: "MOBIS", cantidad: 1 }]);
  });

  test("facetas: qMarca de más de 100 caracteres es ValidationError", async () => {
    await expect(svc.facetasProductos({}, { qMarca: "a".repeat(101) })).rejects.toThrow(
      ValidationError,
    );
  });

  test("buscar y facetas: incluir y excluir la misma columna es ValidationError", async () => {
    const espia = vi.spyOn(repo, "listarFiltrado");
    await expect(svc.buscarProductos({ marcas: "A", sinMarcas: "B" })).rejects.toThrow(
      ValidationError,
    );
    await expect(svc.facetasProductos({ categorias: "A", sinCategorias: "B" })).rejects.toThrow(
      ValidationError,
    );
    expect(espia).not.toHaveBeenCalled();
  });

  test("buscar: sinMarcas filtra de punta a punta", async () => {
    const r = await svc.buscarProductos({ sinMarcas: "MOBIS" });
    expect(r.items.map((p) => p.codigo_interno)).toEqual(["P-2"]);
  });

  test.each([0, -1, 3001, 1.5])("facetas: límite %s inválido", async (limite) => {
    const espia = vi.spyOn(repo, "facetas");
    await expect(svc.facetasProductos({}, { limite })).rejects.toThrow(ValidationError);
    expect(espia).not.toHaveBeenCalled();
  });

  test("facetas: filtros inválidos también son ValidationError", async () => {
    await expect(svc.facetasProductos({ estado: "todos" })).rejects.toThrow(ValidationError);
  });
});
