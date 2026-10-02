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

describe("DefaultCatalogService.loteProductos / facetaProductos", () => {
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

  test("acepta los parámetros de la URL como strings y devuelve el lote con el total", async () => {
    const r = await svc.loteProductos(
      { codigos: "P-1", categorias: "RADIADOR", precioMin: "50" },
      "1",
    );
    expect(r.total).toBe(1);
    expect(r.filas.map((p) => p.codigo_interno)).toEqual(["P-1"]);
    expect(r).toMatchObject({ lote: 1, desde: 0 });
  });

  test("sin parámetros: el lote 1, todo el catálogo", async () => {
    const r = await svc.loteProductos({});
    expect(r.total).toBe(2);
    expect(r.lote).toBe(1);
  });

  test("le pasa al repo los filtros ya normalizados y el número de lote", async () => {
    const espia = vi.spyOn(repo, "listarLote");
    await svc.loteProductos(
      { q: "  aveo  ", conStock: "1", marcas: [SIN_MARCA, "MOBIS"], orden: "precio", dir: "desc" },
      "2",
    );
    expect(espia).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "aveo",
        conStock: true,
        marcas: [SIN_MARCA, "MOBIS"],
        orden: [{ campo: "precio", dir: "desc" }],
      }),
      2,
    );
  });

  test("input inválido: ValidationError y el repo ni se entera", async () => {
    const espia = vi.spyOn(repo, "listarLote");
    await expect(svc.loteProductos({ precioMin: "-5" })).rejects.toThrow(ValidationError);
    await expect(svc.loteProductos({}, "0")).rejects.toThrow(ValidationError);
    await expect(svc.loteProductos({}, "abc")).rejects.toThrow(ValidationError);
    expect(espia).not.toHaveBeenCalled();
  });

  test("lista de valores: límite por defecto 500, y los filtros ya normalizados", async () => {
    const espia = vi.spyOn(repo, "faceta");
    const f = await svc.facetaProductos({ categorias: "RADIADOR" }, { columna: "categoria" });
    expect(espia).toHaveBeenCalledWith(
      expect.objectContaining({ categorias: ["RADIADOR"] }),
      expect.objectContaining({ columna: "categoria", limite: 500 }),
    );
    // La lista de categorías ignora el filtro de categorías: trae las dos.
    expect(f.valores.map((v) => v.valor).sort()).toEqual(["FRENOS", "RADIADOR"]);
  });

  test("lista de valores: límite explícito", async () => {
    const espia = vi.spyOn(repo, "faceta");
    await svc.facetaProductos({}, { columna: "marca", limite: 3000 });
    expect(espia).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limite: 3000 }),
    );
  });

  test("lista de valores: q se normaliza y viaja al repo; en blanco no", async () => {
    const espia = vi.spyOn(repo, "faceta");
    await svc.facetaProductos({}, { columna: "marca", q: "  mob " });
    await svc.facetaProductos({}, { columna: "marca", q: "   " });
    expect(espia.mock.calls[0]?.[1].q).toBe("mob");
    expect(espia.mock.calls[1]?.[1].q).toBeUndefined();
  });

  test("lista de valores: la búsqueda llega hasta el resultado", async () => {
    const f = await svc.facetaProductos({}, { columna: "marca", q: "mob" });
    expect(f.valores).toEqual([{ valor: "MOBIS", cantidad: 1 }]);
  });

  test("lista de valores: q de más de 100 caracteres, o una columna sin lista, es ValidationError", async () => {
    await expect(svc.facetaProductos({}, { columna: "marca", q: "a".repeat(101) })).rejects.toThrow(
      ValidationError,
    );
    await expect(svc.facetaProductos({}, { columna: "precio" })).rejects.toThrow(ValidationError);
  });

  test("lote y lista: incluir y excluir la misma columna es ValidationError", async () => {
    const espia = vi.spyOn(repo, "listarLote");
    await expect(svc.loteProductos({ marcas: "A", sinMarcas: "B" })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      svc.facetaProductos({ categorias: "A", sinCategorias: "B" }, { columna: "categoria" }),
    ).rejects.toThrow(ValidationError);
    expect(espia).not.toHaveBeenCalled();
  });

  test("lote: sinMarcas filtra de punta a punta", async () => {
    const r = await svc.loteProductos({ sinMarcas: "MOBIS" });
    expect(r.filas.map((p) => p.codigo_interno)).toEqual(["P-2"]);
  });

  test.each([0, -1, 3001, 1.5])("lista de valores: límite %s inválido", async (limite) => {
    const espia = vi.spyOn(repo, "faceta");
    await expect(svc.facetaProductos({}, { columna: "marca", limite })).rejects.toThrow(
      ValidationError,
    );
    expect(espia).not.toHaveBeenCalled();
  });

  test("lista de valores: filtros inválidos también son ValidationError", async () => {
    await expect(svc.facetaProductos({ estado: "todos" }, { columna: "marca" })).rejects.toThrow(
      ValidationError,
    );
  });
});
