import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PermissionDeniedError, ValidationError } from "@/lib/errors";
import { parseProductosFiltros } from "@/lib/validation/productos-filtros.schema";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { DefaultCatalogService } from "@/server/services/catalog/default-catalog.service";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  servicio: vi.fn(),
}));

vi.mock("@/server/auth/supabase-ssr", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/bootstrap/catalog-bootstrap", () => ({
  getCatalogServiceForRequest: async () => mocks.servicio(),
}));

const { GET: lote } = await import("@/app/api/productos/lote/route");
const { GET: faceta } = await import("@/app/api/productos/faceta/route");

function pedir(ruta: string, query: string) {
  return new NextRequest(`http://localhost/api/productos/${ruta}${query}`);
}

let repo: InMemoryProductsRepository;

beforeEach(async () => {
  mocks.user.mockReset();
  mocks.servicio.mockReset();
  mocks.user.mockResolvedValue({ id: "u-1" });
  repo = new InMemoryProductsRepository();
  mocks.servicio.mockImplementation(() => new DefaultCatalogService({ productos: repo }));
  for (const [codigo, nombre, marca, precio] of [
    ["10", "Radiador Aveo", "MOBIS", 200],
    ["2", "Válvula EGR", "CHINA", 50],
    ["3", "Bomba de agua", "MOBIS", 80],
  ] as const) {
    await repo.create({
      codigo_interno: codigo,
      sku_proveedor: null,
      nombre,
      descripcion: marca,
      categoria: "MOTOR",
      compatibilidad: [],
      precio,
      stock: 1,
      imagen_url: null,
      activo: true,
    });
  }
});

describe("GET /api/productos/lote", () => {
  test("sin sesión es 401 y no toca el catálogo", async () => {
    mocks.user.mockResolvedValue(null);
    const r = await lote(pedir("lote", ""));
    expect(r.status).toBe(401);
    expect(mocks.servicio).not.toHaveBeenCalled();
  });

  test("devuelve el lote 1 con el total, sin cache", async () => {
    const r = await lote(pedir("lote", "?lote=1"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    expect(body).toMatchObject({ total: 3, lote: 1, desde: 0 });
    expect(body.filas).toHaveLength(3);
  });

  test("sin lote es el primero", async () => {
    const r = await lote(pedir("lote", ""));
    expect((await r.json()).lote).toBe(1);
  });

  test("filtros y orden son los mismos de la URL de la pantalla", async () => {
    const r = await lote(
      pedir("lote", "?marcas=MOBIS&orden=codigo&dir=desc&lote=1&pagina=9&otraCosa=x"),
    );
    const body = await r.json();
    expect(body.total).toBe(2);
    expect(body.filas.map((f: { codigo_interno: string }) => f.codigo_interno)).toEqual([
      "10",
      "3",
    ]);
  });

  test("una clave repetida llega como lista", async () => {
    const r = await lote(pedir("lote", "?marcas=MOBIS&marcas=CHINA&orden=precio&dir=asc"));
    const body = await r.json();
    expect(body.filas.map((f: { precio: number }) => f.precio)).toEqual([50, 80, 200]);
  });

  test("un filtro inválido es 400 con los mensajes que muestra la pantalla", async () => {
    const r = await lote(pedir("lote", "?precioMin=9&precioMax=1"));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({
      error: "Filtros no válidos.",
      mensajes: ["El mínimo de precio no puede ser mayor que el máximo."],
    });
  });

  test("un lote inválido es 400", async () => {
    expect((await lote(pedir("lote", "?lote=0"))).status).toBe(400);
    expect((await lote(pedir("lote", "?lote=abc"))).status).toBe(400);
  });

  test("permiso denegado es 403", async () => {
    mocks.servicio.mockReturnValue({
      loteProductos: () => Promise.reject(new PermissionDeniedError("RLS")),
    });
    const r = await lote(pedir("lote", ""));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("No tenés permiso para ver el catálogo.");
  });

  test("una falla de infraestructura es 500 y no filtra el detalle", async () => {
    mocks.servicio.mockReturnValue({
      loteProductos: () => Promise.reject(new Error("connection refused 10.0.0.1:5432")),
    });
    const r = await lote(pedir("lote", ""));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("10.0.0.1");
  });
});

describe("GET /api/productos/faceta", () => {
  test("sin sesión es 401", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await faceta(pedir("faceta", "?columna=marca"))).status).toBe(401);
  });

  test("devuelve los valores y cuántos hay", async () => {
    const r = await faceta(pedir("faceta", "?columna=marca"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      valores: [
        { valor: "MOBIS", cantidad: 2 },
        { valor: "CHINA", cantidad: 1 },
      ],
      distintos: 2,
    });
  });

  test("busqueda es la búsqueda dentro de la lista; q sigue siendo el buscador general", async () => {
    const dentro = await faceta(pedir("faceta", "?columna=marca&busqueda=chi"));
    expect((await dentro.json()).valores).toEqual([{ valor: "CHINA", cantidad: 1 }]);
    const general = await faceta(pedir("faceta", "?columna=marca&q=radiador"));
    expect((await general.json()).valores).toEqual([{ valor: "MOBIS", cantidad: 1 }]);
  });

  test("la lista ignora los filtros de su columna y respeta los de las otras", async () => {
    const r = await faceta(pedir("faceta", "?columna=marca&marcas=CHINA&codigos=10"));
    // CHINA es la marca elegida: sigue en la lista, sin filas bajo el filtro del código.
    expect((await r.json()).valores).toEqual([
      { valor: "MOBIS", cantidad: 1 },
      { valor: "CHINA", cantidad: 0 },
    ]);
  });

  test("el código busca por igualdad", async () => {
    const r = await faceta(pedir("faceta", "?columna=codigo&busqueda=1"));
    expect((await r.json()).valores).toEqual([]);
    const r2 = await faceta(pedir("faceta", "?columna=codigo&busqueda=10"));
    expect((await r2.json()).valores).toEqual([{ valor: "10", cantidad: 1 }]);
  });

  test("sin columna o con una columna que no tiene lista es 400", async () => {
    expect((await faceta(pedir("faceta", ""))).status).toBe(400);
    expect((await faceta(pedir("faceta", "?columna=precio"))).status).toBe(400);
  });

  test("los mismos filtros que acepta el lote", () => {
    // Si el schema cambia, lote y faceta cambian juntos: los dos pasan por el mismo parse.
    expect(() => parseProductosFiltros({ precioMin: "9", precioMax: "1" })).toThrow(
      ValidationError,
    );
  });
});
