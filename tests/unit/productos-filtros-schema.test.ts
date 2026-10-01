import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  parseProductosFiltros,
  POR_PAGINA_MAX,
  POR_PAGINA_DEFAULT,
  SIN_CATEGORIA,
  SIN_MARCA,
} from "@/lib/validation/productos-filtros.schema";

describe("parseProductosFiltros", () => {
  test("sin parámetros devuelve los defaults: página 1, 50 por página, sin filtros", () => {
    const f = parseProductosFiltros({});
    expect(f).toEqual({
      codigoModo: "contiene",
      descripcionModo: "contiene",
      categorias: [],
      sinCategorias: [],
      marcas: [],
      sinMarcas: [],
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
    const f = parseProductosFiltros({ zzz: "x", "1; drop table productos": "y" });
    expect(f).not.toHaveProperty("zzz");
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

  describe("modo excluir (estilo Excel: todas menos algunas)", () => {
    test("sinMarcas y sinCategorias son listas aparte, con el mismo tratamiento", () => {
      const f = parseProductosFiltros({
        sinMarcas: ["CHINA", " CHINA ", "", SIN_MARCA],
        sinCategorias: "FRENOS",
      });
      expect(f.sinMarcas).toEqual(["CHINA", SIN_MARCA]);
      expect(f.sinCategorias).toEqual(["FRENOS"]);
      expect(f.marcas).toEqual([]);
      expect(f.categorias).toEqual([]);
    });

    test("SIN_CATEGORIA es un valor válido de categorias y de sinCategorias", () => {
      expect(parseProductosFiltros({ categorias: SIN_CATEGORIA }).categorias).toEqual([
        SIN_CATEGORIA,
      ]);
      expect(parseProductosFiltros({ sinCategorias: SIN_CATEGORIA }).sinCategorias).toEqual([
        SIN_CATEGORIA,
      ]);
    });

    test.each([
      ["marcas + sinMarcas", { marcas: "A", sinMarcas: "B" }, /marcas/],
      ["categorias + sinCategorias", { categorias: "A", sinCategorias: "B" }, /categorias/],
    ])("incluir y excluir en la misma columna es ValidationError: %s", (_n, raw, campo) => {
      try {
        parseProductosFiltros(raw);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).message).toMatch(campo);
      }
    });

    test("incluir una columna y excluir la otra sí se puede", () => {
      const f = parseProductosFiltros({ marcas: "A", sinCategorias: "B" });
      expect(f.marcas).toEqual(["A"]);
      expect(f.sinCategorias).toEqual(["B"]);
    });

    test("el tope de 300 valores rige para las listas de exclusión", () => {
      const ok = Array.from({ length: 300 }, (_, i) => `M${i}`);
      expect(parseProductosFiltros({ sinMarcas: ok }).sinMarcas).toHaveLength(300);
      expect(() => parseProductosFiltros({ sinMarcas: [...ok, "M300"] })).toThrow(ValidationError);
      expect(() =>
        parseProductosFiltros({ sinCategorias: Array.from({ length: 301 }, (_, i) => `C${i}`) }),
      ).toThrow(ValidationError);
    });
  });

  describe("espacios: el mismo conjunto que usa SQL (espacio, tab, CR, LF, NBSP)", () => {
    test("quita los cinco en los bordes de textos y de valores de lista", () => {
      const f = parseProductosFiltros({
        codigo: "\t  AB \r\n",
        descripcion: " radiador ",
        marcas: ["\tMOBIS "],
        sinCategorias: [" FRENOS\n"],
      });
      expect(f.codigo).toBe("AB");
      expect(f.descripcion).toBe("radiador");
      expect(f.marcas).toEqual(["MOBIS"]);
      expect(f.sinCategorias).toEqual(["FRENOS"]);
    });

    test("no quita otros espacios Unicode que trim() de JS sí quitaría y btrim de SQL no", () => {
      const f = parseProductosFiltros({ marcas: [" MOBIS"], codigo: "\f\v" });
      expect(f.marcas).toEqual([" MOBIS"]);
      expect(f.codigo).toBe("\f\v");
    });

    test("un valor que queda vacío tras normalizar se descarta", () => {
      expect(parseProductosFiltros({ marcas: [" ", "\t"] }).marcas).toEqual([]);
    });
  });

  describe("q: buscador general", () => {
    test("se lee, se normaliza con los mismos espacios que SQL y se conserva tal cual", () => {
      expect(parseProductosFiltros({ q: "\t  Bomba de agua \r\n" }).q).toBe("Bomba de agua");
    });

    test("vacío, en blanco o ausente es sin filtro", () => {
      expect(parseProductosFiltros({}).q).toBeUndefined();
      expect(parseProductosFiltros({ q: "" }).q).toBeUndefined();
      expect(parseProductosFiltros({ q: "  \t " }).q).toBeUndefined();
    });

    test("acepta 100 caracteres y rechaza 101", () => {
      expect(parseProductosFiltros({ q: "a".repeat(100) }).q).toHaveLength(100);
      expect(() => parseProductosFiltros({ q: "a".repeat(101) })).toThrow(ValidationError);
    });

    test("un q repetido en la URL (array) no es un texto válido", () => {
      expect(() => parseProductosFiltros({ q: ["a", "b"] })).toThrow(ValidationError);
    });

    test("convive con los demás filtros y con la paginación", () => {
      const f = parseProductosFiltros({ q: "aveo", marcas: "MOBIS", pagina: "2" });
      expect(f.q).toBe("aveo");
      expect(f.marcas).toEqual(["MOBIS"]);
      expect(f.pagina).toBe(2);
    });
  });
});
