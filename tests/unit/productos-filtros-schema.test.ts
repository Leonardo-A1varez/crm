import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  parseProductosFiltros,
  POR_PAGINA_MAX,
  POR_PAGINA_DEFAULT,
  SIN_MARCA,
} from "@/lib/validation/productos-filtros.schema";

describe("parseProductosFiltros", () => {
  test("sin parámetros devuelve los defaults: página 1, 50 por página, sin filtros", () => {
    const f = parseProductosFiltros({});
    expect(f).toEqual({
      codigoModo: "contiene",
      descripcionModo: "contiene",
      categorias: [],
      marcas: [],
      conStock: null,
      estado: null,
      pagina: 1,
      porPagina: POR_PAGINA_DEFAULT,
    });
    expect(POR_PAGINA_DEFAULT).toBe(50);
    expect(POR_PAGINA_MAX).toBe(100);
  });

  test("acepta strings de URL y los convierte a número y booleano", () => {
    const f = parseProductosFiltros({
      codigo: "  96817  ",
      codigoModo: "empieza",
      descripcion: "radiador",
      precioMin: "10.5",
      precioMax: "200",
      stockMin: "1",
      stockMax: "30",
      conStock: "1",
      estado: "activo",
      pagina: "3",
      porPagina: "100",
    });
    expect(f.codigo).toBe("96817");
    expect(f.codigoModo).toBe("empieza");
    expect(f.descripcion).toBe("radiador");
    expect(f.precioMin).toBe(10.5);
    expect(f.precioMax).toBe(200);
    expect(f.stockMin).toBe(1);
    expect(f.stockMax).toBe(30);
    expect(f.conStock).toBe(true);
    expect(f.estado).toBe("activo");
    expect(f.pagina).toBe(3);
    expect(f.porPagina).toBe(100);
  });

  test("acepta también valores ya tipados (números y booleanos)", () => {
    const f = parseProductosFiltros({ precioMin: 5, conStock: false, pagina: 2 });
    expect(f.precioMin).toBe(5);
    expect(f.conStock).toBe(false);
    expect(f.pagina).toBe(2);
  });

  test("texto vacío o en blanco equivale a no filtrar", () => {
    const f = parseProductosFiltros({
      codigo: "   ",
      descripcion: "",
      precioMin: "",
      conStock: "",
    });
    expect(f.codigo).toBeUndefined();
    expect(f.descripcion).toBeUndefined();
    expect(f.precioMin).toBeUndefined();
    expect(f.conStock).toBeNull();
  });

  test("conStock '0' y 'false' son false; 'true' es true", () => {
    expect(parseProductosFiltros({ conStock: "0" }).conStock).toBe(false);
    expect(parseProductosFiltros({ conStock: "false" }).conStock).toBe(false);
    expect(parseProductosFiltros({ conStock: "true" }).conStock).toBe(true);
  });

  test("listas: un valor suelto o repetido llega como array, sin vacíos ni duplicados", () => {
    expect(parseProductosFiltros({ categorias: "FRENOS" }).categorias).toEqual(["FRENOS"]);
    const f = parseProductosFiltros({
      categorias: ["FRENOS", " FRENOS ", "", "RADIADOR"],
      marcas: [SIN_MARCA, "MOBIS"],
    });
    expect(f.categorias).toEqual(["FRENOS", "RADIADOR"]);
    expect(f.marcas).toEqual([SIN_MARCA, "MOBIS"]);
  });

  test("ignora claves desconocidas en vez de pasarlas al SQL", () => {
    const f = parseProductosFiltros({ q: "x", "1; drop table productos": "y" });
    expect(f).not.toHaveProperty("q");
    expect(Object.keys(f)).not.toContain("1; drop table productos");
  });

  test.each([
    ["codigoModo inválido", { codigoModo: "termina" }],
    ["estado inválido", { estado: "todos" }],
    ["conStock inválido", { conStock: "quizas" }],
    ["precio negativo", { precioMin: "-1" }],
    ["precio no numérico", { precioMax: "abc" }],
    ["precio infinito", { precioMax: "Infinity" }],
    ["stock decimal", { stockMin: "1.5" }],
    ["stock negativo", { stockMax: -3 }],
    ["rango de precio invertido", { precioMin: "10", precioMax: "5" }],
    ["rango de stock invertido", { stockMin: "10", stockMax: "5" }],
    ["página cero", { pagina: "0" }],
    ["página no entera", { pagina: "1.5" }],
    ["página absurda", { pagina: "10000000" }],
    ["porPagina sobre el máximo", { porPagina: "101" }],
    ["porPagina cero", { porPagina: "0" }],
    ["código de más de 100 caracteres", { codigo: "a".repeat(101) }],
    ["descripción de más de 100 caracteres", { descripcion: "a".repeat(101) }],
    ["más de 300 categorías", { categorias: Array.from({ length: 301 }, (_, i) => `C${i}`) }],
    ["más de 300 marcas", { marcas: Array.from({ length: 301 }, (_, i) => `M${i}`) }],
    ["categoría gigante", { categorias: ["x".repeat(1001)] }],
  ])("rechaza con ValidationError: %s", (_nombre, raw) => {
    expect(() => parseProductosFiltros(raw)).toThrow(ValidationError);
  });

  test("el límite de 300 valores y 100 caracteres es inclusivo", () => {
    const f = parseProductosFiltros({
      codigo: "a".repeat(100),
      categorias: Array.from({ length: 300 }, (_, i) => `C${i}`),
    });
    expect(f.categorias).toHaveLength(300);
    expect(f.codigo).toHaveLength(100);
  });

  test("el mensaje del error nombra el campo inválido", () => {
    try {
      parseProductosFiltros({ precioMin: "-1" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toMatch(/precioMin/);
    }
  });
});
