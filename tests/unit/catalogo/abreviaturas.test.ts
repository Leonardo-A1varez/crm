import { describe, expect, test } from "vitest";
import {
  analizarConsulta,
  cabezaDeExpansion,
  claveDeGrupo,
  esDeGrupoExcluido,
  esRuido,
  expandirFrase,
  indexarAbreviaturas,
  INDICE_VACIO,
  ladoDe,
  nivelDeLado,
  prefijosDe,
  raizDe,
  terminosDe,
  tokensDe,
  abreviaturaActiva,
  type Abreviatura,
} from "@/lib/catalogo/abreviaturas";
import { ABREVIATURAS } from "../../helpers/catalogo-abreviaturas-fixtures";

const indice = indexarAbreviaturas(ABREVIATURAS);

describe("raizDe: la misma raíz para singular, plural y género", () => {
  test.each([
    ["amortiguadores", "amortiguador"],
    ["delanteros", "delantero"],
    ["delantera", "delantero"],
    ["Delanteras", "delantero"],
    ["bases", "base"],
    ["cables", "cable"],
    ["bujías", "bujia"],
    ["frenos", "freno"],
  ])("%s y %s comparten raíz", (a, b) => {
    expect(raizDe(a)).toBe(raizDe(b));
  });

  test("palabras distintas no se mezclan", () => {
    expect(raizDe("freno")).not.toBe(raizDe("fresa"));
    expect(raizDe("delantero")).not.toBe(raizDe("posterior"));
  });

  test("las palabras cortas quedan como están", () => {
    expect(raizDe("luz")).toBe("luz");
    expect(raizDe("eje")).toBe("eje");
  });
});

describe("prefijosDe: una palabra larga puede ser la abreviatura que el catálogo cortó", () => {
  test("amortiguadores -> desde 4 letras, sin la palabra entera", () => {
    const p = prefijosDe("amortiguadores");
    expect(p).toContain("amortig");
    expect(p[0]).toBe("amor");
    expect(p).not.toContain("amortiguadores");
    expect(p.at(-1)).toBe("amortiguadore");
  });

  test("las palabras de menos de 5 letras no tienen prefijos", () => {
    expect(prefijosDe("niro")).toEqual([]);
    expect(prefijosDe("kia")).toEqual([]);
  });

  test("lo que no es solo letras y cifras no se prefija", () => {
    expect(prefijosDe("5w-30")).toEqual([]);
  });

  test("la forma singular es prefijo del plural", () => {
    expect(prefijosDe("frenos")).toContain("freno");
  });
});

describe("tokensDe", () => {
  test("pliega, parte por lo que no es alfanumérico y descarta vacíos", () => {
    expect(tokensDe("AMORTIG COMP/CAPOT")).toEqual(["amortig", "comp", "capot"]);
    expect(tokensDe(null)).toEqual([]);
    expect(tokensDe("  ")).toEqual([]);
  });
});

describe("indexarAbreviaturas: solo las activas", () => {
  const dudosa: Abreviatura = {
    abrev: "XYZ",
    expansion: "cosa",
    tipo: "pieza",
    ambito: "ambos",
    confianza: "media",
    confirmado: false,
  };

  test("confianza alta o confirmada; media y baja sin confirmar no", () => {
    expect(abreviaturaActiva(dudosa)).toBe(false);
    expect(abreviaturaActiva({ ...dudosa, confirmado: true })).toBe(true);
    expect(abreviaturaActiva({ ...dudosa, confianza: "alta" })).toBe(true);
    expect(indexarAbreviaturas([dudosa]).porToken.size).toBe(0);
  });

  test("el ruido solo marca grupos, no se pliega", () => {
    expect(indice.ruidoCategorias.has("repuesto emg")).toBe(true);
    expect(indice.porToken.has("repuesto")).toBe(false);
  });
});

describe("analizarConsulta", () => {
  test("«amortiguadores delanteros»: la pieza es requerida y delanteros es un filtro", () => {
    const r = analizarConsulta("amortiguadores delanteros", indice);
    expect(r.requeridas.map((w) => w.palabra)).toEqual(["amortiguadores"]);
    expect(r.lados).toEqual(["delantero"]);
    const w = r.requeridas[0];
    expect(w?.abrevs.map((a) => a.abrev)).toEqual(["AMORTIG"]);
    expect(terminosDe(w!).map((t) => t.token)).toContain("amortig");
  });

  test("sin abreviaturas todas las palabras son requeridas y quedan los prefijos", () => {
    const r = analizarConsulta("amortiguadores delanteros", INDICE_VACIO);
    expect(r.requeridas.map((w) => w.palabra)).toEqual(["amortiguadores", "delanteros"]);
    expect(r.lados).toEqual([]);
    expect(terminosDe(r.requeridas[0]!).map((t) => t.token)).toContain("amortig");
  });

  test("izquierdo y derecho son lados; la abreviatura escrita tal cual también", () => {
    expect(analizarConsulta("amortiguador izquierdo", indice).lados).toEqual(["izquierdo"]);
    expect(analizarConsulta("amortiguador rh", indice).lados).toEqual(["derecho"]);
  });

  test("el relleno y las repetidas se descartan", () => {
    const r = analizarConsulta("necesito el amortiguador amortiguador de la", indice);
    expect(r.palabras.map((w) => w.palabra)).toEqual(["amortiguador"]);
  });
});

describe("lados", () => {
  test("ladoDe lee la expansión", () => {
    expect(ladoDe("delantero")).toBe("delantero");
    expect(ladoDe("delantera")).toBe("delantero");
    expect(ladoDe("trasero")).toBe("posterior");
    expect(ladoDe("izquierdo")).toBe("izquierdo");
    expect(ladoDe("derecha")).toBe("derecho");
    expect(ladoDe("superior")).toBe("superior");
    expect(ladoDe("inferior")).toBe("inferior");
    expect(ladoDe("central")).toBeNull();
  });

  test("nivelDeLado: el lado pedido gana, sin lado es neutro y el contrario se descarta", () => {
    const pedido = ["delantero"] as const;
    expect(
      nivelDeLado({ categoria: "AMORTIG DELT", nombre: "KIA NIRO HYB 17- LH" }, pedido, indice),
    ).toBe(2);
    expect(
      nivelDeLado({ categoria: "AMORTIG POST", nombre: "KIA NIRO HYB 17-" }, pedido, indice),
    ).toBe(0);
    expect(nivelDeLado({ categoria: "AMORTIGUADOR", nombre: "KIA NIRO" }, pedido, indice)).toBe(1);
    expect(nivelDeLado({ categoria: "AMORTIG POST", nombre: "X" }, [], indice)).toBe(1);
  });

  test("izquierdo y delantero son familias distintas: pedir los dos exige los dos", () => {
    const pedido = ["delantero", "izquierdo"] as const;
    expect(nivelDeLado({ categoria: "AMORTIG DELT", nombre: "NIRO LH" }, pedido, indice)).toBe(2);
    expect(nivelDeLado({ categoria: "AMORTIG DELT", nombre: "NIRO RH" }, pedido, indice)).toBe(0);
    expect(nivelDeLado({ categoria: "AMORTIG DELT", nombre: "NIRO" }, pedido, indice)).toBe(1);
  });
});

describe("ruido y frases", () => {
  test("REPUESTO EMG es ruido, AMORTIG DELT no", () => {
    expect(esRuido({ categoria: "REPUESTO EMG", nombre: "X" }, indice)).toBe(true);
    expect(esRuido({ categoria: "AMORTIG DELT", nombre: "X" }, indice)).toBe(false);
  });

  test("expandirFrase pone la categoría en palabras del cliente", () => {
    expect(expandirFrase("AMORTIG DELT", indice)).toBe("amortiguador delantero");
    expect(expandirFrase("BOMBA DE AGUA", indice)).toBe("bomba de agua");
  });
});

describe("expansiones del CSV del dueño", () => {
  test("cabezaDeExpansion corta en el paréntesis y en el punto y coma", () => {
    expect(cabezaDeExpansion("posterior (trasero)")).toBe("posterior");
    expect(cabezaDeExpansion("izquierdo (lado del conductor en Ecuador)")).toBe("izquierdo");
    expect(cabezaDeExpansion("distribución (de motor); ¿distribuidor?")).toBe("distribución");
    expect(cabezaDeExpansion("diesel")).toBe("diesel");
  });

  test("«traseros» se pliega a POST aunque la expansión diga «posterior (trasero)»", () => {
    expect(analizarConsulta("amortiguadores traseros", indice).lados).toEqual(["posterior"]);
  });

  test("«superior» e «inferior» también son lados y se excluyen entre sí", () => {
    expect(analizarConsulta("brazo superior", indice).lados).toEqual(["superior"]);
    expect(nivelDeLado({ categoria: "BRAZO", nombre: "KIA INF" }, ["superior"], indice)).toBe(0);
    expect(nivelDeLado({ categoria: "BRAZO", nombre: "KIA SUP" }, ["superior"], indice)).toBe(2);
  });

  test("una palabra de atributo («diesel») no obliga y no es un lado", () => {
    const r = analizarConsulta("filtro diesel", indice);
    expect(r.requeridas.map((w) => w.palabra)).toEqual(["filtro"]);
    expect(r.lados).toEqual([]);
    expect(r.atributos).toEqual(["dsl"]);
  });

  test("si TODAS las palabras son filtros, valen como texto: la consulta no queda vacía", () => {
    const r = analizarConsulta("izquierdo", indice);
    expect(r.requeridas.map((w) => w.palabra)).toEqual(["izquierdo"]);
    expect(r.lados).toEqual([]);
  });

  test("el ámbito evita la trampa: SEN es sensor en la categoría, no en el nombre", () => {
    const w = analizarConsulta("sensor", indice).requeridas[0];
    expect(terminosDe(w!)).toContainEqual({ token: "sen", ambito: "categoria" });
  });

  test("DEL como posición en el nombre y DEL como preposición (ruido) conviven", () => {
    const duplicadas = indexarAbreviaturas([
      ...ABREVIATURAS,
      {
        abrev: "DEL",
        expansion: "«del» (preposición: no es una posición)",
        tipo: "ruido",
        ambito: "categoria",
        confianza: "alta",
        confirmado: false,
      },
    ]);
    expect(duplicadas.porToken.get("del")?.map((a) => a.tipo)).toEqual(["posicion"]);
    expect(duplicadas.ruidoCategorias.has("del")).toBe(true);
    // Un grupo con «del» adentro no es ruido: solo el que se llama así.
    expect(esRuido({ categoria: "POLEA DEL CIGUEÑAL", nombre: "X" }, duplicadas)).toBe(false);
  });
});

describe("grupos excluidos", () => {
  const grupos = new Set(["repuesto emg", "gastos varios"]);

  test("se compara sin mayúsculas, tildes ni blancos de los extremos", () => {
    expect(claveDeGrupo("  Repuesto EMG ")).toBe("repuesto emg");
    expect(esDeGrupoExcluido({ categoria: "REPUESTO EMG" }, grupos)).toBe(true);
    expect(esDeGrupoExcluido({ categoria: "gastos varios " }, grupos)).toBe(true);
  });

  test("un grupo parecido o sin categoría no se excluye", () => {
    expect(esDeGrupoExcluido({ categoria: "REPUESTO" }, grupos)).toBe(false);
    expect(esDeGrupoExcluido({ categoria: null }, grupos)).toBe(false);
  });
});
