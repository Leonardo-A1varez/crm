import { describe, expect, test } from "vitest";
import {
  CAMPOS_ORDEN,
  COLUMNAS_LISTA,
  DEFINICIONES_LISTA,
  leerNiveles,
} from "@/lib/catalogo/columnas-productos";
import { ValidationError } from "@/lib/errors";
import {
  LOTE_MAX,
  LOTE_TAMANO,
  parseLote,
  parseOpcionesFaceta,
  parseProductosFiltros,
  SIN_CATEGORIA,
  SIN_MARCA,
} from "@/lib/validation/productos-filtros.schema";

describe("parseProductosFiltros", () => {
  test("sin parámetros devuelve los defaults: sin filtros y sin orden elegido", () => {
    const f = parseProductosFiltros({});
    expect(f).toEqual({
      codigos: [],
      sinCodigos: [],
      codigosFabrica: [],
      sinCodigosFabrica: [],
      otrosCodigos: [],
      sinOtrosCodigos: [],
      categorias: [],
      sinCategorias: [],
      descripciones: [],
      sinDescripciones: [],
      marcas: [],
      sinMarcas: [],
      conStock: null,
      estado: null,
      orden: [],
    });
    expect(LOTE_TAMANO).toBe(1000);
  });

  test("acepta strings de URL y los convierte a número y booleano", () => {
    const f = parseProductosFiltros({
      precioMin: "10.5",
      precioMax: "200",
      stockMin: "1",
      stockMax: "30",
      conStock: "1",
      estado: "activo",
    });
    expect(f.precioMin).toBe(10.5);
    expect(f.precioMax).toBe(200);
    expect(f.stockMin).toBe(1);
    expect(f.stockMax).toBe(30);
    expect(f.conStock).toBe(true);
    expect(f.estado).toBe("activo");
  });

  test("acepta también valores ya tipados (números y booleanos)", () => {
    const f = parseProductosFiltros({ precioMin: 5, conStock: false });
    expect(f.precioMin).toBe(5);
    expect(f.conStock).toBe(false);
  });

  test("texto vacío o en blanco equivale a no filtrar", () => {
    const f = parseProductosFiltros({ q: "   ", precioMin: "", conStock: "" });
    expect(f.q).toBeUndefined();
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

  test("las seis columnas tienen su lista de incluir y de excluir", () => {
    const entrada: Record<string, string> = {};
    for (const c of COLUMNAS_LISTA) {
      entrada[DEFINICIONES_LISTA[c].incluir] = `i-${c}`;
    }
    const f = parseProductosFiltros(entrada);
    for (const c of COLUMNAS_LISTA) {
      expect(f[DEFINICIONES_LISTA[c].incluir]).toEqual([`i-${c}`]);
      expect(f[DEFINICIONES_LISTA[c].excluir]).toEqual([]);
    }
    const excluir: Record<string, string> = {};
    for (const c of COLUMNAS_LISTA) excluir[DEFINICIONES_LISTA[c].excluir] = `x-${c}`;
    const g = parseProductosFiltros(excluir);
    for (const c of COLUMNAS_LISTA) expect(g[DEFINICIONES_LISTA[c].excluir]).toEqual([`x-${c}`]);
  });

  test("ignora claves desconocidas en vez de pasarlas al SQL, también la paginación de antes", () => {
    const f = parseProductosFiltros({
      zzz: "x",
      "1; drop table productos": "y",
      pagina: "3",
      porPagina: "50",
      codigo: "viejo",
      descripcion: "viejo",
    });
    expect(Object.keys(f)).not.toContain("zzz");
    expect(Object.keys(f)).not.toContain("1; drop table productos");
    expect(Object.keys(f)).not.toContain("pagina");
    expect(Object.keys(f)).not.toContain("codigo");
    expect(Object.keys(f)).not.toContain("descripcion");
  });

  test.each([
    ["estado inválido", { estado: "todos" }],
    ["conStock inválido", { conStock: "quizas" }],
    ["precio negativo", { precioMin: "-1" }],
    ["precio no numérico", { precioMax: "abc" }],
    ["precio infinito", { precioMax: "Infinity" }],
    ["stock decimal", { stockMin: "1.5" }],
    ["stock negativo", { stockMax: -3 }],
    ["rango de precio invertido", { precioMin: "10", precioMax: "5" }],
    ["rango de stock invertido", { stockMin: "10", stockMax: "5" }],
    ["más de 300 categorías", { categorias: Array.from({ length: 301 }, (_, i) => `C${i}`) }],
    ["más de 300 marcas", { marcas: Array.from({ length: 301 }, (_, i) => `M${i}`) }],
    ["más de 300 códigos", { codigos: Array.from({ length: 301 }, (_, i) => `${i}`) }],
    ["más de 300 descripciones", { descripciones: Array.from({ length: 301 }, (_, i) => `D${i}`) }],
    ["categoría gigante", { categorias: ["x".repeat(1001)] }],
  ])("rechaza con ValidationError: %s", (_nombre, raw) => {
    expect(() => parseProductosFiltros(raw)).toThrow(ValidationError);
  });

  test("el límite de 300 valores es inclusivo", () => {
    const f = parseProductosFiltros({
      categorias: Array.from({ length: 300 }, (_, i) => `C${i}`),
    });
    expect(f.categorias).toHaveLength(300);
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

    test.each(COLUMNAS_LISTA)(
      "incluir y excluir en la misma columna es ValidationError: %s",
      (columna) => {
        const d = DEFINICIONES_LISTA[columna];
        try {
          parseProductosFiltros({ [d.incluir]: "A", [d.excluir]: "B" });
          expect.unreachable();
        } catch (e) {
          expect(e).toBeInstanceOf(ValidationError);
          expect((e as ValidationError).message).toMatch(d.incluir);
        }
      },
    );

    test("incluir una columna y excluir la otra sí se puede", () => {
      const f = parseProductosFiltros({ marcas: "A", sinCategorias: "B" });
      expect(f.marcas).toEqual(["A"]);
      expect(f.sinCategorias).toEqual(["B"]);
    });

    test("el tope de 300 valores rige para las listas de exclusión", () => {
      const ok = Array.from({ length: 300 }, (_, i) => `M${i}`);
      expect(parseProductosFiltros({ sinMarcas: ok }).sinMarcas).toHaveLength(300);
      expect(() => parseProductosFiltros({ sinMarcas: [...ok, "M300"] })).toThrow(ValidationError);
    });
  });

  describe("espacios: el mismo conjunto que usa SQL (espacio, tab, CR, LF, NBSP)", () => {
    test("quita los cinco en los bordes de textos y de valores de lista", () => {
      const f = parseProductosFiltros({
        q: "\t  AB \r\n",
        marcas: ["\tMOBIS "],
        sinCategorias: [" FRENOS\n"],
      });
      expect(f.q).toBe("AB");
      expect(f.marcas).toEqual(["MOBIS"]);
      expect(f.sinCategorias).toEqual(["FRENOS"]);
    });

    test("no quita otros espacios Unicode que trim() de JS sí quitaría y btrim de SQL no", () => {
      const f = parseProductosFiltros({ marcas: ["\u2003MOBIS"], q: "\f\v" });
      expect(f.marcas).toEqual(["\u2003MOBIS"]);
      expect(f.q).toBe("\f\v");
    });

    test("un valor que queda vacío tras normalizar se descarta", () => {
      expect(parseProductosFiltros({ marcas: [" ", "\t"] }).marcas).toEqual([]);
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

    test("convive con los demás filtros", () => {
      const f = parseProductosFiltros({ q: "aveo", marcas: "MOBIS" });
      expect(f.q).toBe("aveo");
      expect(f.marcas).toEqual(["MOBIS"]);
    });
  });

  describe("orden: orden=campo&dir=asc|desc, repetidos", () => {
    test("un nivel: sin dir es ascendente, solo desc invierte", () => {
      expect(parseProductosFiltros({ orden: "marca" }).orden).toEqual([
        { campo: "marca", dir: "asc" },
      ]);
      expect(parseProductosFiltros({ orden: "marca", dir: "desc" }).orden).toEqual([
        { campo: "marca", dir: "desc" },
      ]);
      expect(parseProductosFiltros({ orden: "marca", dir: "DESC" }).orden).toEqual([
        { campo: "marca", dir: "asc" },
      ]);
    });

    test("hasta tres niveles: cada dir va con el orden de su posición", () => {
      const f = parseProductosFiltros({
        orden: ["categoria", "precio", "stock", "estado"],
        dir: ["asc", "desc", "desc", "asc"],
      });
      expect(f.orden).toEqual([
        { campo: "categoria", dir: "asc" },
        { campo: "precio", dir: "desc" },
        { campo: "stock", dir: "desc" },
      ]);
    });

    test("un campo desconocido o repetido se descarta y el orden cae al por defecto (vacío)", () => {
      expect(parseProductosFiltros({ orden: "nombre; drop table productos" }).orden).toEqual([]);
      expect(
        parseProductosFiltros({ orden: ["precio", "precio"], dir: ["desc", "asc"] }).orden,
      ).toEqual([{ campo: "precio", dir: "desc" }]);
    });

    test("un nivel desconocido en el medio no corre los dir de los demás", () => {
      const f = parseProductosFiltros({
        orden: ["marca", "xxx", "precio"],
        dir: ["asc", "desc", "desc"],
      });
      expect(f.orden).toEqual([
        { campo: "marca", dir: "asc" },
        { campo: "precio", dir: "desc" },
      ]);
    });

    test("acepta los niveles ya armados desde código", () => {
      const f = parseProductosFiltros({
        orden: [
          { campo: "precio", dir: "desc" },
          { campo: "nada", dir: "asc" },
          { campo: "codigo", dir: "asc" },
        ],
      });
      expect(f.orden).toEqual([
        { campo: "precio", dir: "desc" },
        { campo: "codigo", dir: "asc" },
      ]);
    });

    test("todos los campos de orden son los de la lista blanca", () => {
      expect([...CAMPOS_ORDEN]).toEqual([
        "codigo",
        "codigoFabrica",
        "otrosCodigos",
        "categoria",
        "descripcion",
        "marca",
        "precio",
        "precio_matriz",
        "precio_magdalena",
        "precio_koreanos",
        "precio_sas_repuestos",
        "stock",
        "estado",
      ]);
      expect(leerNiveles(["precio"], [])).toEqual([{ campo: "precio", dir: "asc" }]);
    });
  });
});

describe("parseLote", () => {
  test("sin valor es el primero; acepta strings de URL y números", () => {
    expect(parseLote(undefined)).toBe(1);
    expect(parseLote("")).toBe(1);
    expect(parseLote("4")).toBe(4);
    expect(parseLote(2)).toBe(2);
  });

  test.each(["0", "-1", "1.5", "abc", String(LOTE_MAX + 1)])("rechaza %s", (v) => {
    expect(() => parseLote(v)).toThrow(ValidationError);
  });

  test("el tope es inclusivo", () => {
    expect(parseLote(LOTE_MAX)).toBe(LOTE_MAX);
  });
});

describe("parseOpcionesFaceta", () => {
  test("acepta las seis columnas con lista", () => {
    for (const c of COLUMNAS_LISTA) {
      expect(parseOpcionesFaceta({ columna: c }).columna).toBe(c);
    }
  });

  test("la columna es obligatoria y no puede ser una que no tenga lista", () => {
    expect(() => parseOpcionesFaceta({})).toThrow(ValidationError);
    expect(() => parseOpcionesFaceta({ columna: "precio" })).toThrow(ValidationError);
    expect(() => parseOpcionesFaceta({ columna: "" })).toThrow(ValidationError);
  });

  test("q se normaliza y en blanco no viaja; el límite por defecto es 500", () => {
    expect(parseOpcionesFaceta({ columna: "marca", q: "  mob " }).q).toBe("mob");
    expect(parseOpcionesFaceta({ columna: "marca", q: "   " }).q).toBeUndefined();
    expect(parseOpcionesFaceta({ columna: "marca" }).limite).toBe(500);
  });

  test.each([0, -1, 3001, 1.5])("límite %s inválido", (limite) => {
    expect(() => parseOpcionesFaceta({ columna: "marca", limite })).toThrow(ValidationError);
  });

  test("q de más de 100 caracteres es ValidationError", () => {
    expect(() => parseOpcionesFaceta({ columna: "marca", q: "a".repeat(101) })).toThrow(
      ValidationError,
    );
  });
});
