import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cargadoresDeRed,
  ErrorLectura,
  leerFaceta,
  leerLote,
} from "@/components/productos/cliente-productos";

const FILA = {
  id: "a",
  codigo_interno: "1",
  codigo_fabrica: null,
  otros_codigos: [],
  sku_proveedor: null,
  nombre: "Producto",
  descripcion: null,
  categoria: null,
  precio: 10,
  precio_matriz: 12.5,
  precio_magdalena: null,
  precio_koreanos: 10,
  precio_sas_repuestos: 0,
  codigo_difiere: false,
  erp_actualizado_at: "2026-10-06T12:00:00+00:00",
  stock: 1,
  activo: true,
};

function respuesta(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("leerLote", () => {
  test("acepta la forma que devuelve el servidor", () => {
    expect(leerLote({ filas: [FILA], total: 1, lote: 1, desde: 0 })).toEqual({
      filas: [FILA],
      total: 1,
      lote: 1,
      desde: 0,
    });
  });

  test("acepta precio null (a consultar) y una fila que nunca vino del ERP", () => {
    const sinPrecio = {
      ...FILA,
      precio: null,
      precio_matriz: null,
      precio_koreanos: null,
      precio_sas_repuestos: null,
      erp_actualizado_at: null,
    };
    expect(leerLote({ filas: [sinPrecio], total: 1, lote: 1, desde: 0 }).filas).toEqual([
      sinPrecio,
    ]);
  });

  test.each([
    ["no es un objeto", null],
    [
      "un precio del ERP como texto",
      { filas: [{ ...FILA, precio_matriz: "1" }], total: 1, lote: 1, desde: 0 },
    ],
    [
      "codigo_difiere ausente",
      { filas: [{ ...FILA, codigo_difiere: undefined }], total: 1, lote: 1, desde: 0 },
    ],
    [
      "erp_actualizado_at numérico",
      { filas: [{ ...FILA, erp_actualizado_at: 5 }], total: 1, lote: 1, desde: 0 },
    ],
    ["un arreglo", []],
    ["total negativo", { filas: [], total: -1, lote: 1, desde: 0 }],
    ["lote cero", { filas: [], total: 0, lote: 0, desde: 0 }],
    ["una fila sin id", { filas: [{ ...FILA, id: 5 }], total: 1, lote: 1, desde: 0 }],
    ["precio como texto", { filas: [{ ...FILA, precio: "10" }], total: 1, lote: 1, desde: 0 }],
    ["más filas que un lote", { filas: Array(1001).fill(FILA), total: 1001, lote: 1, desde: 0 }],
    ["filas que no es una lista", { filas: "x", total: 0, lote: 1, desde: 0 }],
  ])("rechaza: %s", (_n, v) => {
    expect(() => leerLote(v)).toThrow(ErrorLectura);
  });
});

describe("leerFaceta", () => {
  test("acepta valores y cuántos hay", () => {
    expect(leerFaceta({ valores: [{ valor: "A", cantidad: 2 }], distintos: 1 })).toEqual({
      valores: [{ valor: "A", cantidad: 2 }],
      distintos: 1,
    });
  });

  test.each([
    ["sin distintos", { valores: [] }],
    ["un valor sin cantidad", { valores: [{ valor: "A" }], distintos: 1 }],
    ["cantidad decimal", { valores: [{ valor: "A", cantidad: 1.5 }], distintos: 1 }],
    ["no es un objeto", "x"],
  ])("rechaza: %s", (_n, v) => {
    expect(() => leerFaceta(v)).toThrow(ErrorLectura);
  });
});

describe("cargadoresDeRed", () => {
  test("lote: pide /api/productos/lote con la consulta y el número de lote, con el misma sesión", async () => {
    const fetchFalso = vi.fn(async () =>
      respuesta({ filas: [FILA], total: 1, lote: 2, desde: 1000 }),
    );
    vi.stubGlobal("fetch", fetchFalso);
    const senal = new AbortController().signal;
    const r = await cargadoresDeRed.lote("marcas=A&orden=precio&dir=desc", 2, senal);
    expect(r.lote).toBe(2);
    expect(fetchFalso).toHaveBeenCalledWith(
      "/api/productos/lote?marcas=A&orden=precio&dir=desc&lote=2",
      { signal: senal, credentials: "same-origin" },
    );
  });

  test("faceta: manda la columna y la búsqueda dentro de la lista; sin búsqueda no la manda", async () => {
    const fetchFalso = vi.fn(async (_url: string, _init?: RequestInit) =>
      respuesta({ valores: [], distintos: 0 }),
    );
    vi.stubGlobal("fetch", fetchFalso);
    const senal = new AbortController().signal;
    await cargadoresDeRed.faceta("q=x", "marca", "mob", senal);
    await cargadoresDeRed.faceta("q=x", "codigo", "", senal);
    expect(fetchFalso.mock.calls[0]?.[0]).toBe(
      "/api/productos/faceta?q=x&columna=marca&busqueda=mob",
    );
    expect(fetchFalso.mock.calls[1]?.[0]).toBe("/api/productos/faceta?q=x&columna=codigo");
  });

  test("un 400 trae los mensajes del servidor; otro estado, el error; un cuerpo ilegible, el código HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuesta({ error: "Filtros no válidos.", mensajes: ["a", 3, "b"] }, 400)),
    );
    const senal = new AbortController().signal;
    await expect(cargadoresDeRed.lote("", 1, senal)).rejects.toMatchObject({
      name: "ErrorLectura",
      estado: 400,
      mensajes: ["a", "b"],
      message: "Filtros no válidos.",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no es json", { status: 502 })),
    );
    await expect(cargadoresDeRed.lote("", 1, senal)).rejects.toMatchObject({
      estado: 502,
      message: "HTTP 502",
      mensajes: [],
    });
  });

  test("sin sesión (401) es un ErrorLectura, no una lista vacía", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuesta({ error: "Sin sesión." }, 401)),
    );
    await expect(
      cargadoresDeRed.faceta("", "marca", "", new AbortController().signal),
    ).rejects.toMatchObject({ estado: 401 });
  });
});
