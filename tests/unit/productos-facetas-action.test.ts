import { beforeEach, describe, expect, test, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { FacetasActionSchema } from "@/lib/validation/productos-facetas-action.schema";
import { LISTA_MAX, parseProductosFiltros } from "@/lib/validation/productos-filtros.schema";

const mocks = vi.hoisted(() => ({ facetasProductos: vi.fn() }));

vi.mock("@/server/bootstrap/catalog-bootstrap", () => ({
  getCatalogServiceForRequest: async () => ({ facetasProductos: mocks.facetasProductos }),
}));

const { facetasProductosAction } =
  await import("@/app/(panel)/productos/_actions/facetas-productos.action");

/** Facetas inventadas para ilustrar la respuesta. */
const FACETAS = {
  categorias: { valores: [{ valor: "Frenos", cantidad: 3 }], distintos: 1 },
  marcas: { valores: [{ valor: "Alfa", cantidad: 3 }], distintos: 1 },
};

beforeEach(() => {
  mocks.facetasProductos.mockReset();
  mocks.facetasProductos.mockResolvedValue(FACETAS);
});

describe("FacetasActionSchema", () => {
  test("acepta los filtros de la URL, con listas, y la búsqueda de cada lista", () => {
    const r = FacetasActionSchema.safeParse({
      filtros: { q: "bomba", sinMarcas: ["A", "B"], precioMin: "10", estado: "activo" },
      qMarca: "al",
    });
    expect(r.success).toBe(true);
  });

  test("rechaza lo que no es un objeto de filtros y las listas pasadas de tope", () => {
    expect(FacetasActionSchema.safeParse({ filtros: "x" }).success).toBe(false);
    expect(FacetasActionSchema.safeParse(undefined).success).toBe(false);
    const larga = Array.from({ length: LISTA_MAX + 1 }, (_, i) => `v${i}`);
    expect(FacetasActionSchema.safeParse({ filtros: { marcas: larga } }).success).toBe(false);
  });

  test("q es un texto de hasta 1000 caracteres, no una lista", () => {
    expect(FacetasActionSchema.safeParse({ filtros: { q: ["a", "b"] } }).success).toBe(false);
  });

  test("un valor suelto de una clave que no es lista no puede ser un array", () => {
    expect(FacetasActionSchema.safeParse({ filtros: { codigo: ["a", "b"] } }).success).toBe(false);
  });

  test("acota la búsqueda a 100 caracteres", () => {
    expect(FacetasActionSchema.safeParse({ filtros: {}, qMarca: "x".repeat(101) }).success).toBe(
      false,
    );
  });
});

describe("facetasProductosAction", () => {
  test("pasa los filtros y la búsqueda al service y devuelve las facetas", async () => {
    const r = await facetasProductosAction({
      filtros: { estado: "activo", sinMarcas: ["A"] },
      qCategoria: "fre",
    });
    expect(r).toEqual({ ok: true, facetas: FACETAS });
    expect(mocks.facetasProductos).toHaveBeenCalledWith(
      { estado: "activo", sinMarcas: ["A"] },
      { qCategoria: "fre", qMarca: undefined, columna: undefined },
    );
  });

  test("columna viaja al service para que calcule solo esa lista", async () => {
    await facetasProductosAction({ filtros: {}, columna: "marca", qMarca: "al" });
    expect(mocks.facetasProductos).toHaveBeenCalledWith(
      {},
      { qCategoria: undefined, qMarca: "al", columna: "marca" },
    );
  });

  test("una columna que no existe se rechaza", async () => {
    const r = await facetasProductosAction({ filtros: {}, columna: "precio" });
    expect(r.ok).toBe(false);
    expect(mocks.facetasProductos).not.toHaveBeenCalled();
  });

  test("un pedido mal formado se rechaza antes de tocar el service", async () => {
    const r = await facetasProductosAction({ filtros: 7 });
    expect(r.ok).toBe(false);
    expect(mocks.facetasProductos).not.toHaveBeenCalled();
  });

  test("filtros que el service rechaza vuelven como mensaje claro, no como excepción", async () => {
    mocks.facetasProductos.mockImplementation(() => {
      try {
        parseProductosFiltros({ precioMin: "9", precioMax: "1" });
      } catch (e) {
        return Promise.reject(e);
      }
      return Promise.resolve(FACETAS);
    });
    const r = await facetasProductosAction({ filtros: { precioMin: "9", precioMax: "1" } });
    expect(r).toEqual({
      ok: false,
      error: "El mínimo de precio no puede ser mayor que el máximo.",
    });
  });

  test("un ValidationError sin issues igual devuelve un mensaje genérico", async () => {
    mocks.facetasProductos.mockRejectedValue(new ValidationError("x"));
    const r = await facetasProductosAction({ filtros: {} });
    expect(r).toEqual({ ok: false, error: "Hay filtros en la URL que no son válidos." });
  });

  test("una falla de infraestructura no filtra el detalle al cliente", async () => {
    mocks.facetasProductos.mockRejectedValue(new Error("connection refused 10.0.0.1:5432"));
    const r = await facetasProductosAction({ filtros: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("10.0.0.1");
  });
});
