import { describe, expect, test } from "vitest";
import { COLUMNAS_LISTA, DEFINICIONES_LISTA } from "@/lib/catalogo/columnas-productos";
import { ValidationError } from "@/lib/errors";
import {
  aplicarGrupos,
  aUrlSearchParams,
  avisoDeLista,
  consultaCanonica,
  errorDeRango,
  gruposActivos,
  hayFiltros,
  hrefCon,
  leerFiltros,
  leerOrden,
  limpiarGrupos,
  limpiarTodo,
  mensajesDeFiltrosInvalidos,
  numeroCanonico,
  numeroEditable,
  parsearNumero,
  resumirFiltros,
  valoresDeLista,
  valorLegible,
} from "@/lib/ui/filtros-productos";
import {
  LISTA_MAX,
  parseProductosFiltros,
  SIN_CATEGORIA,
  SIN_MARCA,
} from "@/lib/validation/productos-filtros.schema";

/** Nombres y valores de estos tests son inventados para ilustrar la URL. */

describe("leerFiltros", () => {
  test("una URL vacía no tiene filtros ni orden elegido", () => {
    const f = leerFiltros(new URLSearchParams());
    expect(hayFiltros(f)).toBe(false);
    expect(f.orden).toEqual([]);
    expect(f.conStock).toBeNull();
    expect(f.estado).toBeNull();
    for (const c of COLUMNAS_LISTA) expect(f.listas[c]).toEqual({ incluir: [], excluir: [] });
  });

  test("lee las claves repetidas como lista y respeta incluir y excluir por separado", () => {
    const f = leerFiltros(
      new URLSearchParams(
        "marcas=Alfa&marcas=Beta&sinCategorias=Uno&codigos=10&sinOtrosCodigos=ZZ&conStock=1&estado=inactivo&descripciones=Bomba",
      ),
    );
    expect(f.listas.marca).toEqual({ incluir: ["Alfa", "Beta"], excluir: [] });
    expect(f.listas.categoria).toEqual({ incluir: [], excluir: ["Uno"] });
    expect(f.listas.codigo.incluir).toEqual(["10"]);
    expect(f.listas.otrosCodigos.excluir).toEqual(["ZZ"]);
    expect(f.listas.descripcion.incluir).toEqual(["Bomba"]);
    expect(f.conStock).toBe("1");
    expect(f.estado).toBe("inactivo");
  });

  test("acepta el formato de searchParams de Next (string o string[])", () => {
    const f = leerFiltros({ marcas: ["A", "B"], precioMin: "10", estado: "activo" });
    expect(f.listas.marca.incluir).toEqual(["A", "B"]);
    expect(f.precioMin).toBe("10");
    expect(f.estado).toBe("activo");
  });

  test("un valor que no entiende cae al neutro y nunca tira; la paginación de antes no existe", () => {
    const f = leerFiltros(new URLSearchParams("conStock=quizas&estado=otro&pagina=3&porPagina=9"));
    expect(f.conStock).toBeNull();
    expect(f.estado).toBeNull();
    expect(Object.keys(f)).not.toContain("pagina");
  });

  test("un filtro puesto se detecta por grupo, en el orden de las columnas", () => {
    const f = leerFiltros(new URLSearchParams("sinMarcas=X&stockMax=5&descripciones=bomba&q=hola"));
    expect(gruposActivos(f)).toEqual(["busqueda", "descripcion", "marca", "stock"]);
  });

  test("el orden de la URL se valida contra los campos y se corta en tres", () => {
    const f = leerFiltros(
      new URLSearchParams(
        "orden=marca&dir=desc&orden=xxx&dir=asc&orden=precio&orden=stock&orden=estado",
      ),
    );
    expect(f.orden).toEqual([
      { campo: "marca", dir: "desc" },
      { campo: "precio", dir: "asc" },
      { campo: "stock", dir: "asc" },
    ]);
    expect(leerOrden({ orden: "codigo", dir: "desc" })).toEqual([{ campo: "codigo", dir: "desc" }]);
  });

  test("recorta los espacios con el mismo conjunto que SQL (no con trim())", () => {
    const f = leerFiltros(new URLSearchParams({ q: "\t bomba \r\n" }));
    expect(f.q).toBe("bomba");
  });
});

describe("aplicarGrupos y limpiarGrupos", () => {
  test("cambiar un filtro conserva el orden y los demás filtros", () => {
    const p = aplicarGrupos("estado=activo&orden=precio&dir=desc", ["precio"], {
      precioMin: "10",
      precioMax: "50",
    });
    expect(p.get("estado")).toBe("activo");
    expect(p.getAll("orden")).toEqual(["precio"]);
    expect(p.getAll("dir")).toEqual(["desc"]);
    expect(p.get("precioMin")).toBe("10");
    expect(p.get("precioMax")).toBe("50");
  });

  test("saca los parámetros de la paginación que hayan quedado en un link viejo", () => {
    const p = aplicarGrupos("pagina=4&porPagina=20&estado=activo", ["precio"], { precioMin: "1" });
    expect(p.get("pagina")).toBeNull();
    expect(p.get("porPagina")).toBeNull();
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
    const p = aplicarGrupos("q=x", ["busqueda"], { q: "" });
    expect(p.toString()).toBe("");
  });

  test.each(COLUMNAS_LISTA)("limpiarGrupos saca las dos claves de %s", (columna) => {
    const d = DEFINICIONES_LISTA[columna];
    const p = limpiarGrupos(`${d.incluir}=a&${d.excluir}=b&estado=activo`, [columna]);
    expect(p.toString()).toBe("estado=activo");
  });

  test("limpiarTodo saca los filtros pero deja el orden", () => {
    const p = limpiarTodo(
      "q=x&marcas=A&codigos=1&precioMin=3&stockMin=1&conStock=1&estado=activo&orden=marca&dir=asc",
    );
    expect(p.toString()).toBe("orden=marca&dir=asc");
  });

  test("hrefCon no deja un ? suelto", () => {
    expect(hrefCon("/productos", new URLSearchParams())).toBe("/productos");
    expect(hrefCon("/productos", new URLSearchParams("a=1"))).toBe("/productos?a=1");
  });

  test("aUrlSearchParams repite la clave por cada valor de un array de Next", () => {
    const p = aUrlSearchParams({ marcas: ["A", "B"], q: "x", nada: undefined });
    expect(p.toString()).toBe("marcas=A&marcas=B&q=x");
  });
});

describe("consultaCanonica: la URL reducida a lo que define las filas", () => {
  test("dos URLs que significan lo mismo dan el mismo texto, sin importar el orden de las claves ni de los valores", () => {
    const a = consultaCanonica("marcas=B&marcas=A&q=x&estado=activo");
    const b = consultaCanonica("estado=activo&q=x&marcas=A&marcas=B");
    expect(a).toBe(b);
  });

  test("descarta lo que no es un filtro ni un orden: parámetros desconocidos, vacíos y duplicados", () => {
    expect(consultaCanonica("zzz=1&pagina=3&marcas=A&marcas=A&marcas=&q=")).toBe("marcas=A");
  });

  test("los niveles de orden conservan su orden: el primero manda", () => {
    expect(consultaCanonica("orden=marca&dir=desc&orden=precio&dir=asc")).toBe(
      "orden=marca&dir=desc&orden=precio&dir=asc",
    );
    expect(consultaCanonica("orden=precio&dir=asc&orden=marca&dir=desc")).not.toBe(
      consultaCanonica("orden=marca&dir=desc&orden=precio&dir=asc"),
    );
  });

  test("sinOrden deja los filtros solos: las listas de valores no dependen del orden", () => {
    expect(consultaCanonica("marcas=A&orden=precio&dir=desc", { sinOrden: true })).toBe("marcas=A");
  });

  test("sinColumna quita los filtros de esa columna (los dos modos) y no los de las otras", () => {
    const q = "marcas=A&sinCategorias=B&q=x";
    expect(consultaCanonica(q, { sinOrden: true, sinColumna: "marca" })).toBe(
      "q=x&sinCategorias=B",
    );
    expect(consultaCanonica(q, { sinOrden: true, sinColumna: "categoria" })).toBe("q=x&marcas=A");
  });

  test("un orden inválido no entra en la consulta", () => {
    expect(consultaCanonica("orden=nombre&dir=desc")).toBe("");
  });

  test("el mismo conjunto, escrito con un orden distinto, es otra consulta (otras filas en otro lugar)", () => {
    expect(consultaCanonica("marcas=A")).not.toBe(
      consultaCanonica("marcas=A&orden=precio&dir=asc"),
    );
  });
});

describe("valoresDeLista y avisoDeLista", () => {
  test("cada resolución se traduce a las claves de su columna", () => {
    expect(valoresDeLista({ tipo: "sin-filtro" }, "marca")).toEqual({});
    expect(valoresDeLista({ tipo: "incluir", valores: ["A"] }, "marca")).toEqual({ marcas: ["A"] });
    expect(valoresDeLista({ tipo: "excluir", valores: ["A"] }, "otrosCodigos")).toEqual({
      sinOtrosCodigos: ["A"],
    });
    expect(valoresDeLista({ tipo: "incluir", valores: ["1"] }, "codigo")).toEqual({
      codigos: ["1"],
    });
    expect(valoresDeLista({ tipo: "ninguno" }, "marca")).toBeNull();
    expect(valoresDeLista({ tipo: "demasiados", cantidad: 400 }, "marca")).toBeNull();
  });

  test("el aviso nombra la columna y solo existe cuando no se puede aplicar", () => {
    expect(avisoDeLista({ tipo: "ninguno" }, "codigoFabrica")).toBe(
      "Marcá al menos un valor de códigos de fábrica.",
    );
    expect(avisoDeLista({ tipo: "demasiados", cantidad: 500 }, "marca")).toContain(
      String(LISTA_MAX),
    );
    expect(avisoDeLista({ tipo: "sin-filtro" }, "marca")).toBeNull();
    expect(avisoDeLista({ tipo: "incluir", valores: ["A"] }, "marca")).toBeNull();
  });
});

describe("resumirFiltros: los chips", () => {
  test("sin filtros no hay chips", () => {
    expect(resumirFiltros(leerFiltros(new URLSearchParams()))).toEqual([]);
  });

  test("un chip por filtro puesto, en el orden de las columnas", () => {
    const r = resumirFiltros(
      leerFiltros(
        new URLSearchParams(
          "estado=activo&precioMin=10&marcas=Alfa&codigos=10&q=bomba&stockMin=3&conStock=1&descripciones=Radiador",
        ),
      ),
    );
    expect(r.map((x) => x.grupo)).toEqual([
      "busqueda",
      "codigo",
      "descripcion",
      "marca",
      "precio",
      "stock",
      "estado",
    ]);
    expect(r.map((x) => x.texto)).toEqual([
      "Búsqueda: “bomba”",
      "Código: 10",
      "Descripción: Radiador",
      "Marca: Alfa",
      "Precio: desde 10",
      "Stock: con stock, desde 3",
      "Estado: Activo",
    ]);
  });

  test("excluir se dice 'todas menos' (o 'todos menos' en los códigos) y cuenta cuando son muchos", () => {
    const r = (q: string) =>
      resumirFiltros(leerFiltros(new URLSearchParams(q))).map((x) => x.texto);
    expect(r("sinMarcas=A&sinMarcas=B")).toEqual(["Marca: todas menos A, B"]);
    expect(r("sinMarcas=A&sinMarcas=B&sinMarcas=C")).toEqual(["Marca: todas menos 3 marcas"]);
    expect(r("sinCodigosFabrica=X")).toEqual(["Cód. fábrica: todos menos X"]);
    expect(r("sinCategorias=A&sinCategorias=B&sinCategorias=C")).toEqual([
      "Categoría: todas menos 3 categorías",
    ]);
  });

  test("los valores vacíos se dicen en palabras, sin los paréntesis", () => {
    expect(valorLegible(SIN_MARCA)).toBe("sin marca");
    expect(valorLegible(SIN_CATEGORIA)).toBe("sin categoría");
    expect(valorLegible("MOBIS")).toBe("MOBIS");
    const r = resumirFiltros(leerFiltros(new URLSearchParams({ marcas: SIN_MARCA })));
    expect(r[0]?.texto).toBe("Marca: sin marca");
  });

  test("rangos: de a, desde, hasta", () => {
    const r = (q: string) =>
      resumirFiltros(leerFiltros(new URLSearchParams(q))).map((x) => x.texto);
    expect(r("precioMin=1&precioMax=5")).toEqual(["Precio: 1 a 5"]);
    expect(r("stockMax=9")).toEqual(["Stock: hasta 9"]);
    expect(r("conStock=0")).toEqual(["Stock: sin stock"]);
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
    expect(errorDeRango("abc", "", o)).toMatch(/número/);
    expect(errorDeRango("", "", o)).toBeNull();
  });
});

describe("mensajesDeFiltrosInvalidos", () => {
  function issuesDe(raw: unknown) {
    try {
      parseProductosFiltros(raw);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      return (e as ValidationError).issues;
    }
    throw new Error("se esperaba un ValidationError");
  }

  test("un rango invertido se explica con el nombre de la columna", () => {
    expect(mensajesDeFiltrosInvalidos(issuesDe({ precioMin: "9", precioMax: "1" }))).toEqual([
      "El mínimo de precio no puede ser mayor que el máximo.",
    ]);
    expect(mensajesDeFiltrosInvalidos(issuesDe({ stockMin: "9", stockMax: "1" }))).toEqual([
      "El mínimo de stock no puede ser mayor que el máximo.",
    ]);
  });

  test("incluir y excluir juntos, en cualquiera de las seis columnas", () => {
    for (const c of COLUMNAS_LISTA) {
      const d = DEFINICIONES_LISTA[c];
      const m = mensajesDeFiltrosInvalidos(issuesDe({ [d.incluir]: "A", [d.excluir]: "B" }));
      expect(m[0]).toContain(d.etiqueta);
      expect(m[0]).toContain("incluye y excluye");
    }
  });

  test("demasiados valores en una lista", () => {
    const larga = Array.from({ length: LISTA_MAX + 1 }, (_, i) => `v${i}`);
    expect(mensajesDeFiltrosInvalidos(issuesDe({ otrosCodigos: larga }))[0]).toContain(
      `más de ${LISTA_MAX}`,
    );
  });

  test("el buscador y los números tienen su mensaje", () => {
    expect(mensajesDeFiltrosInvalidos(issuesDe({ q: "a".repeat(101) }))[0]).toContain("100");
    expect(mensajesDeFiltrosInvalidos(issuesDe({ precioMin: "-1" }))[0]).toContain("número");
  });

  test("una forma que no reconoce cae en un mensaje genérico", () => {
    expect(mensajesDeFiltrosInvalidos(undefined)).toEqual([
      "Hay filtros en la URL que no son válidos.",
    ]);
    expect(mensajesDeFiltrosInvalidos([{ path: ["zzz"] }, 5])).toEqual([
      "Hay filtros en la URL que no son válidos.",
    ]);
  });
});
