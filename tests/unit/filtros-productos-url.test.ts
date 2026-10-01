import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  aplicarGrupos,
  aUrlSearchParams,
  avisoDeLista,
  conPagina,
  errorDeRango,
  filtrosParaFacetas,
  gruposActivos,
  hayFiltros,
  hrefCon,
  leerFiltros,
  limpiarGrupos,
  limpiarTodo,
  mensajesDeFiltrosInvalidos,
  numeroCanonico,
  numeroEditable,
  parsearNumero,
  rangoDePagina,
  resumirFiltros,
  valoresDeLista,
} from "@/lib/ui/filtros-productos";
import {
  LISTA_MAX,
  parseProductosFiltros,
  SIN_CATEGORIA,
  SIN_MARCA,
} from "@/lib/validation/productos-filtros.schema";

/** Nombres y valores de estos tests son inventados para ilustrar la URL. */

describe("leerFiltros", () => {
  test("una URL vacía no tiene filtros y cae a la página 1 con 50 por página", () => {
    const f = leerFiltros(new URLSearchParams());
    expect(hayFiltros(f)).toBe(false);
    expect(f.pagina).toBe(1);
    expect(f.porPagina).toBe(50);
    expect(f.codigoModo).toBe("contiene");
    expect(f.conStock).toBeNull();
    expect(f.estado).toBeNull();
  });

  test("lee las claves repetidas como lista y respeta incluir y excluir por separado", () => {
    const f = leerFiltros(
      new URLSearchParams(
        "marcas=Alfa&marcas=Beta&sinCategorias=Uno&codigo=ab&codigoModo=empieza&conStock=1&estado=inactivo&pagina=3",
      ),
    );
    expect(f.marcas).toEqual(["Alfa", "Beta"]);
    expect(f.sinMarcas).toEqual([]);
    expect(f.sinCategorias).toEqual(["Uno"]);
    expect(f.codigo).toBe("ab");
    expect(f.codigoModo).toBe("empieza");
    expect(f.conStock).toBe("1");
    expect(f.estado).toBe("inactivo");
    expect(f.pagina).toBe(3);
  });

  test("acepta el formato de searchParams de Next (string o string[])", () => {
    const f = leerFiltros({ marcas: ["A", "B"], precioMin: "10", estado: "activo" });
    expect(f.marcas).toEqual(["A", "B"]);
    expect(f.precioMin).toBe("10");
    expect(f.estado).toBe("activo");
  });

  test("un valor que no entiende cae al neutro y nunca tira", () => {
    const f = leerFiltros(
      new URLSearchParams("conStock=quizas&estado=otro&codigoModo=raro&pagina=abc&porPagina=9999"),
    );
    expect(f.conStock).toBeNull();
    expect(f.estado).toBeNull();
    expect(f.codigoModo).toBe("contiene");
    expect(f.pagina).toBe(1);
    expect(f.porPagina).toBe(100);
  });

  test("un filtro puesto se detecta por grupo", () => {
    const f = leerFiltros(new URLSearchParams("sinMarcas=X&stockMax=5&descripcion=bomba"));
    expect(gruposActivos(f)).toEqual(["descripcion", "marca", "stock"]);
  });
});

describe("aplicarGrupos y limpiarGrupos", () => {
  test("cambiar un filtro vuelve a la página 1 y conserva porPagina y los demás filtros", () => {
    const p = aplicarGrupos("pagina=4&porPagina=20&estado=activo", ["precio"], {
      precioMin: "10",
      precioMax: "50",
    });
    expect(p.get("pagina")).toBeNull();
    expect(p.get("porPagina")).toBe("20");
    expect(p.get("estado")).toBe("activo");
    expect(p.get("precioMin")).toBe("10");
    expect(p.get("precioMax")).toBe("50");
  });

  test("reemplaza las claves del grupo: pasar de incluir a excluir no deja las dos", () => {
    const p = aplicarGrupos("marcas=A&marcas=B", ["marca"], { sinMarcas: ["C"] });
    expect(p.getAll("marcas")).toEqual([]);
    expect(p.getAll("sinMarcas")).toEqual(["C"]);
  });

  test("escribe una clave repetida por cada valor, con los valores especiales tal cual", () => {
    const p = aplicarGrupos("", ["marca"], { marcas: [SIN_MARCA, "Kia"] });
    expect(p.getAll("marcas")).toEqual([SIN_MARCA, "Kia"]);
    expect(p.toString()).toBe("marcas=%28sin+marca%29&marcas=Kia");
  });

  test("un valor vacío o undefined deja la clave fuera de la URL", () => {
    const p = aplicarGrupos("codigo=x&codigoModo=empieza", ["codigo"], {
      codigo: "",
      codigoModo: undefined,
    });
    expect(p.toString()).toBe("");
  });

  test("limpiarGrupos saca solo ese grupo, con su modo", () => {
    const p = limpiarGrupos("codigo=x&codigoModo=empieza&estado=activo&pagina=2", ["codigo"]);
    expect(p.toString()).toBe("estado=activo");
  });

  test("limpiarTodo saca todos los filtros y la página, no porPagina", () => {
    const p = limpiarTodo(
      "codigo=x&sinCategorias=A&precioMin=1&conStock=0&estado=activo&pagina=5&porPagina=25",
    );
    expect(p.toString()).toBe("porPagina=25");
  });
});

describe("conPagina, hrefCon y aUrlSearchParams", () => {
  test("la página 1 se escribe sin parámetro", () => {
    expect(conPagina("estado=activo&pagina=3", 1).toString()).toBe("estado=activo");
    expect(conPagina("estado=activo", 4).toString()).toBe("estado=activo&pagina=4");
  });

  test("hrefCon no deja un signo de pregunta suelto", () => {
    expect(hrefCon("/productos", new URLSearchParams())).toBe("/productos");
    expect(hrefCon("/productos", new URLSearchParams("a=1"))).toBe("/productos?a=1");
  });

  test("aUrlSearchParams repite la clave de un array y salta lo indefinido", () => {
    const p = aUrlSearchParams({ marcas: ["A", "B"], estado: "activo", pagina: undefined });
    expect(p.toString()).toBe("marcas=A&marcas=B&estado=activo");
  });

  test("filtrosParaFacetas deja afuera pagina y porPagina y agrupa las claves repetidas", () => {
    const f = filtrosParaFacetas(
      new URLSearchParams("sinMarcas=A&sinMarcas=B&precioMin=5&pagina=2&porPagina=10&otra=x"),
    );
    expect(f).toEqual({ sinMarcas: ["A", "B"], precioMin: "5" });
  });
});

describe("resumirFiltros", () => {
  const resumen = (q: string) => resumirFiltros(leerFiltros(new URLSearchParams(q)));

  test("sin filtros no hay chips", () => {
    expect(resumen("")).toEqual([]);
  });

  test("texto con su modo", () => {
    expect(resumen("codigo=ab&codigoModo=empieza")).toEqual([
      { grupo: "codigo", texto: "Código empieza con “ab”" },
    ]);
    expect(resumen("descripcion=bomba")).toEqual([
      { grupo: "descripcion", texto: "Descripción contiene “bomba”" },
    ]);
  });

  test("incluir lista hasta dos valores y después cuenta", () => {
    expect(resumen("marcas=Kia")[0]?.texto).toBe("Marca: Kia");
    expect(resumen("marcas=Kia&marcas=Audi")[0]?.texto).toBe("Marca: Kia, Audi");
    expect(resumen("marcas=A&marcas=B&marcas=C")[0]?.texto).toBe("Marca: 3 valores");
  });

  test("excluir dice 'todas menos' y traduce los comodines", () => {
    expect(resumen(`sinMarcas=${encodeURIComponent(SIN_MARCA)}`)[0]?.texto).toBe(
      "Marca: todas menos sin marca",
    );
    expect(
      resumen(`sinCategorias=${encodeURIComponent(SIN_CATEGORIA)}&sinCategorias=Frenos`)[0]?.texto,
    ).toBe("Categoría: todas menos sin categoría, Frenos");
    expect(resumen("sinCategorias=A&sinCategorias=B&sinCategorias=C")[0]?.texto).toBe(
      "Categoría: todas menos 3 categorías",
    );
  });

  test("rangos: desde, hasta y entre", () => {
    expect(resumen("precioMin=100")[0]?.texto).toBe("Precio: desde 100");
    expect(resumen("precioMax=250")[0]?.texto).toBe("Precio: hasta 250");
    expect(resumen("stockMin=1&stockMax=10")[0]?.texto).toBe("Stock: 1 a 10");
  });

  test("stock suma con/sin stock al rango", () => {
    expect(resumen("conStock=1&stockMin=5")[0]?.texto).toBe("Stock: con stock, desde 5");
    expect(resumen("conStock=0")[0]?.texto).toBe("Stock: sin stock");
  });

  test("estado y el orden de las columnas", () => {
    const r = resumen("estado=inactivo&codigo=x&sinMarcas=A&precioMin=1");
    expect(r.map((x) => x.grupo)).toEqual(["codigo", "marca", "precio", "estado"]);
    expect(r.at(-1)?.texto).toBe("Estado: Inactivo");
  });
});

describe("errorDeRango", () => {
  test("vacío o bien formado no tiene error", () => {
    expect(errorDeRango("", "", { entero: false, nombre: "precio" })).toBeNull();
    expect(errorDeRango("5", "", { entero: false, nombre: "precio" })).toBeNull();
    expect(errorDeRango("1.5", "2.5", { entero: false, nombre: "precio" })).toBeNull();
    expect(errorDeRango("5", "5", { entero: true, nombre: "stock" })).toBeNull();
  });

  test("mínimo mayor que máximo", () => {
    expect(errorDeRango("10", "5", { entero: false, nombre: "precio" })).toBe(
      "El mínimo de precio no puede ser mayor que el máximo.",
    );
  });

  test("negativos y no numéricos", () => {
    expect(errorDeRango("-1", "", { entero: false, nombre: "precio" })).toMatch(/desde 0/);
    expect(errorDeRango("", "abc", { entero: false, nombre: "precio" })).toMatch(/máximo/);
  });

  test("el stock tiene que ser entero", () => {
    expect(errorDeRango("1.5", "", { entero: true, nombre: "stock" })).toMatch(/entero/);
  });
});

describe("rangoDePagina", () => {
  test("primera, intermedia y última página", () => {
    expect(rangoDePagina(1300, 1, 50)).toEqual({ totalPaginas: 26, desde: 1, hasta: 50 });
    expect(rangoDePagina(1300, 26, 50)).toEqual({ totalPaginas: 26, desde: 1251, hasta: 1300 });
    expect(rangoDePagina(67, 2, 50)).toEqual({ totalPaginas: 2, desde: 51, hasta: 67 });
  });

  test("sin resultados hay una página y rango en cero", () => {
    expect(rangoDePagina(0, 1, 50)).toEqual({ totalPaginas: 1, desde: 0, hasta: 0 });
  });

  test("un total exacto no suma una página de más", () => {
    expect(rangoDePagina(100, 2, 50)).toEqual({ totalPaginas: 2, desde: 51, hasta: 100 });
  });
});

describe("valoresDeLista y avisoDeLista", () => {
  test("incluir y excluir eligen su clave; sin filtro limpia la columna", () => {
    expect(valoresDeLista({ tipo: "incluir", valores: ["A"] }, "marcas", "sinMarcas")).toEqual({
      marcas: ["A"],
    });
    expect(valoresDeLista({ tipo: "excluir", valores: ["B"] }, "marcas", "sinMarcas")).toEqual({
      sinMarcas: ["B"],
    });
    expect(valoresDeLista({ tipo: "sin-filtro" }, "marcas", "sinMarcas")).toEqual({});
  });

  test("nada marcado y demasiados no se pueden aplicar", () => {
    expect(valoresDeLista({ tipo: "ninguno" }, "marcas", "sinMarcas")).toBeNull();
    expect(valoresDeLista({ tipo: "demasiados", cantidad: 400 }, "marcas", "sinMarcas")).toBeNull();
  });

  test("el aviso explica por qué, y no hay aviso si se puede aplicar", () => {
    expect(avisoDeLista({ tipo: "ninguno" }, "marca")).toMatch(/al menos un valor/);
    expect(avisoDeLista({ tipo: "demasiados", cantidad: 400 }, "marca")).toContain(
      String(LISTA_MAX),
    );
    expect(avisoDeLista({ tipo: "incluir", valores: ["A"] }, "marca")).toBeNull();
    expect(avisoDeLista({ tipo: "sin-filtro" }, "marca")).toBeNull();
  });
});

describe("mensajesDeFiltrosInvalidos con los errores reales del schema", () => {
  function mensajes(raw: Record<string, unknown>): string[] {
    try {
      parseProductosFiltros(raw);
    } catch (e) {
      if (e instanceof ValidationError) return mensajesDeFiltrosInvalidos(e.issues);
      throw e;
    }
    throw new Error("se esperaba un ValidationError");
  }

  test("rango de precio y de stock invertidos", () => {
    const m = mensajes({ precioMin: "500", precioMax: "100", stockMin: "9", stockMax: "2" });
    expect(m).toContain("El mínimo de precio no puede ser mayor que el máximo.");
    expect(m).toContain("El mínimo de stock no puede ser mayor que el máximo.");
  });

  test("incluir y excluir marcas a la vez", () => {
    const m = mensajes({ marcas: "A", sinMarcas: "B" });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/^Marca: .*incluye y excluye/);
  });

  test("más de 300 valores", () => {
    const m = mensajes({ sinCategorias: Array.from({ length: LISTA_MAX + 1 }, (_, i) => `c${i}`) });
    expect(m).toEqual([expect.stringContaining(String(LISTA_MAX))]);
    expect(m[0]).toMatch(/^Categoría:/);
  });

  test("texto demasiado largo y número inválido", () => {
    expect(mensajes({ codigo: "x".repeat(101) })).toEqual([
      expect.stringMatching(/^Código: .*100 caracteres/),
    ]);
    expect(mensajes({ precioMin: "abc" })).toEqual([expect.stringMatching(/^Precio:/)]);
  });

  test("una forma que no reconoce cae en un mensaje genérico", () => {
    expect(mensajesDeFiltrosInvalidos(undefined)).toEqual([
      "Hay filtros en la URL que no son válidos.",
    ]);
    expect(mensajesDeFiltrosInvalidos([{ path: ["raro"], message: "x" }])).toEqual([
      "Hay filtros en la URL que no son válidos.",
    ]);
  });
});

describe("q: buscador general en la URL", () => {
  test("leerFiltros lee q recortado y sin q queda vacío", () => {
    expect(leerFiltros(new URLSearchParams("q=%20bomba%20")).q).toBe("bomba");
    expect(leerFiltros(new URLSearchParams()).q).toBe("");
    expect(leerFiltros({ q: ["a", "b"] }).q).toBe("a");
  });

  test("cuenta como filtro: hayFiltros y el grupo 'busqueda'", () => {
    const f = leerFiltros(new URLSearchParams("q=bomba"));
    expect(hayFiltros(f)).toBe(true);
    expect(gruposActivos(f)).toEqual(["busqueda"]);
    expect(hayFiltros(leerFiltros(new URLSearchParams("q=%20")))).toBe(false);
  });

  test("aplicarGrupos escribe q, vuelve a la página 1 y conserva los otros filtros", () => {
    const p = aplicarGrupos("estado=activo&pagina=4&porPagina=20", ["busqueda"], { q: "bomba" });
    expect(p.get("q")).toBe("bomba");
    expect(p.get("pagina")).toBeNull();
    expect(p.get("estado")).toBe("activo");
    expect(p.get("porPagina")).toBe("20");
  });

  test("q vacío saca la clave, y reemplaza el q anterior en vez de sumarse", () => {
    expect(aplicarGrupos("q=viejo&estado=activo", ["busqueda"], { q: "" }).toString()).toBe(
      "estado=activo",
    );
    expect(aplicarGrupos("q=viejo", ["busqueda"], { q: "nuevo" }).getAll("q")).toEqual(["nuevo"]);
  });

  test("limpiarTodo saca q, y limpiarGrupos de otro grupo no lo toca", () => {
    expect(limpiarTodo("q=bomba&estado=activo&porPagina=25").toString()).toBe("porPagina=25");
    expect(limpiarGrupos("q=bomba&estado=activo", ["estado"]).toString()).toBe("q=bomba");
  });

  test("q viaja a las facetas junto con los demás filtros", () => {
    expect(filtrosParaFacetas(new URLSearchParams("q=bomba&pagina=2&sinMarcas=A"))).toEqual({
      q: "bomba",
      sinMarcas: "A",
    });
  });

  test("el chip dice 'Búsqueda' y va primero", () => {
    const r = resumirFiltros(leerFiltros(new URLSearchParams("estado=activo&q=bomba+de+agua")));
    expect(r[0]).toEqual({ grupo: "busqueda", texto: "Búsqueda: “bomba de agua”" });
    expect(r.map((x) => x.grupo)).toEqual(["busqueda", "estado"]);
  });
});

describe("números escritos a la manera de es: coma decimal y punto de miles", () => {
  test.each([
    ["1500", 1500],
    ["1500,50", 1500.5],
    ["1500.50", 1500.5],
    ["1.500,50", 1500.5],
    ["1.500", 1500],
    ["12.345.678", 12345678],
    ["0,5", 0.5],
    ["0.500", 0.5],
    ["2.5", 2.5],
    ["1,", null],
    ["  7,25  ", 7.25],
    ["", null],
  ])("parsearNumero(%j) = %j", (texto, esperado) => {
    expect(parsearNumero(texto)).toBe(esperado);
  });

  test.each(["abc", "-1", "1,5,2", "1.5,2", "1..500", "1.50.0", "1e3", "Infinity", ",5", "."])(
    "parsearNumero(%j) no es un número válido",
    (texto) => {
      expect(parsearNumero(texto)).toBeNull();
    },
  );

  test("numeroCanonico lo deja como lo lee el backend: punto decimal, sin miles", () => {
    expect(numeroCanonico("1.500,50")).toBe("1500.5");
    expect(numeroCanonico("1500,50")).toBe("1500.5");
    expect(numeroCanonico("1.500")).toBe("1500");
    expect(numeroCanonico("  ")).toBe("");
    expect(numeroCanonico("abc")).toBeNull();
  });

  test("numeroEditable muestra lo que viene de la URL con coma decimal y sin miles", () => {
    expect(numeroEditable("1500.5")).toBe("1500,5");
    expect(numeroEditable("1500")).toBe("1500");
    expect(numeroEditable("")).toBe("");
    // Un valor de URL que el backend rechazaría se muestra tal cual, no se corrige en silencio.
    expect(numeroEditable("abc")).toBe("abc");
  });

  test("numeroEditable y numeroCanonico son inversos", () => {
    for (const v of ["0", "0.5", "1500.5", "1234567.89"]) {
      expect(numeroCanonico(numeroEditable(v))).toBe(v);
    }
  });

  test("errorDeRango entiende la coma y el punto de miles", () => {
    const o = { entero: false, nombre: "precio" };
    expect(errorDeRango("1500,50", "2.000,25", o)).toBeNull();
    expect(errorDeRango("2.000,25", "1500,50", o)).toMatch(/no puede ser mayor/);
    expect(errorDeRango("1,5", "", { entero: true, nombre: "stock" })).toMatch(/entero/);
    expect(errorDeRango("1.500", "", { entero: true, nombre: "stock" })).toBeNull();
  });
});
