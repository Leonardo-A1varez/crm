import { describe, expect, test } from "vitest";
import { indexarAbreviaturas } from "@/lib/catalogo/abreviaturas";
import {
  encabezadoCotizacion,
  formatearPrecio,
  lineaDeOpcion,
  nombreCortoRelacionada,
  textoCotizacion,
  textoRelacionadas,
} from "@/lib/catalogo/formato-cotizacion";
import { ABREVIATURAS } from "../../helpers/catalogo-abreviaturas-fixtures";

const bomba = { query: "bomba de agua", marca: "Hyundai", modelo: "Accent" };
const termostato = { query: "termostato", marca: "Hyundai", modelo: "Accent" };

describe("nombreCortoRelacionada", () => {
  test("otra categoría: quita la pieza pedida y el ruido del ERP", () => {
    expect(nombreCortoRelacionada("POLEA BOMBA AGUA E HIDRAU", bomba)).toBe("la polea");
  });

  test("subpieza: su nombre corto con artículo", () => {
    expect(nombreCortoRelacionada("BOMBA DE AGUA (empaque)", bomba)).toBe("el empaque");
    expect(nombreCortoRelacionada("BOMBA DE AGUA (oring)", bomba)).toBe("el o-ring");
    expect(nombreCortoRelacionada("TERMOSTATOS (base)", termostato)).toBe("la base");
    expect(nombreCortoRelacionada("TERMOSTATOS (tapa)", termostato)).toBe("la tapa");
    expect(nombreCortoRelacionada("BOMBA DE AGUA (reten)", bomba)).toBe("el retén");
    expect(nombreCortoRelacionada("BOMBA DE AGUA (kit)", bomba)).toBe("el kit");
  });

  test("conjunto completo: la pieza principal con 'completo' concordando en género", () => {
    expect(nombreCortoRelacionada("TERMOSTATO ARMADO Y TAPAS (conjunto completo)", bomba)).toBe(
      "el termostato completo",
    );
    expect(nombreCortoRelacionada("BOMBA DE AGUA (conjunto completo)", termostato)).toBe(
      "la bomba de agua completa",
    );
  });

  test("la misma categoría que se pidió sin subpieza: la pieza entera", () => {
    expect(
      nombreCortoRelacionada("BOMBA DE AGUA", { ...bomba, query: "empaque de la bomba" }),
    ).toBe("la bomba de agua");
    expect(nombreCortoRelacionada("TERMOSTATOS", bomba)).toBe("el termostato");
  });
});

describe("textoRelacionadas", () => {
  const cierre = "también dispongo. ¿Desea que le cotice?";

  test("una sola pieza", () => {
    expect(textoRelacionadas(["POLEA BOMBA AGUA E HIDRAU"], bomba)).toBe(
      `Si necesita la polea, ${cierre}`,
    );
    expect(textoRelacionadas(["TERMOSTATO ARMADO Y TAPAS (conjunto completo)"], bomba)).toBe(
      `Si necesita el termostato completo, ${cierre}`,
    );
  });

  test("varias: separa con coma y la última con 'o'", () => {
    expect(textoRelacionadas(["POLEA BOMBA AGUA E HIDRAU", "BOMBA DE AGUA (empaque)"], bomba)).toBe(
      `Si necesita la polea o el empaque, ${cierre}`,
    );
    expect(
      textoRelacionadas(
        ["POLEA BOMBA AGUA E HIDRAU", "BOMBA DE AGUA (empaque)", "TERMOSTATOS (tapa)"],
        bomba,
      ),
    ).toBe(`Si necesita la polea, el empaque o la tapa, ${cierre}`);
  });

  test("trata de usted: sin voseo ni tuteo", () => {
    const t = textoRelacionadas(["POLEA BOMBA AGUA E HIDRAU"], bomba) ?? "";
    expect(t).not.toMatch(/\bte\b|\btú\b|\bvos\b|querés|necesitás/i);
  });

  test("sin relacionadas no hay línea", () => {
    expect(textoRelacionadas([], bomba)).toBeNull();
  });
});

describe("encabezadoCotizacion", () => {
  test("pieza + modelo + año, con IVA una sola vez", () => {
    expect(encabezadoCotizacion("BOMBA DE AGUA", { modelo: "Accent", anio: 2006 })).toBe(
      "Bomba de agua Accent 2006 (IVA incluido):",
    );
  });

  test("cilindrada cuando se conoce; marca si no hay modelo; solo la pieza si no hay vehículo", () => {
    expect(
      encabezadoCotizacion("TERMOSTATOS", { modelo: "Accent", anio: 2006, cilindrada: "1.6" }),
    ).toBe("Termostato Accent 2006 1.6 (IVA incluido):");
    expect(encabezadoCotizacion("BOMBA DE AGUA", { marca: "Kia" })).toBe(
      "Bomba de agua Kia (IVA incluido):",
    );
    expect(encabezadoCotizacion("BOMBA DE AGUA", {})).toBe("Bomba de agua (IVA incluido):");
  });

  test("la subpieza de una categoría armada se nombra por su pieza, sin ruido del ERP", () => {
    expect(
      encabezadoCotizacion("TERMOSTATO ARMADO Y TAPAS (base)", { modelo: "Accent", anio: 2006 }),
    ).toBe("Base de termostato Accent 2006 (IVA incluido):");
  });

  test("una subpieza se nombra con su pieza", () => {
    expect(encabezadoCotizacion("BOMBA DE AGUA (empaque)", { modelo: "Accent", anio: 2006 })).toBe(
      "Empaque de bomba de agua Accent 2006 (IVA incluido):",
    );
    expect(
      encabezadoCotizacion("TERMOSTATO ARMADO Y TAPAS (conjunto completo)", { modelo: "Accent" }),
    ).toBe("Termostato completo Accent (IVA incluido):");
  });
});

describe("nombreCortoRelacionada: género, artículo y «de» con nombres reales del ERP", () => {
  const indice = indexarAbreviaturas(ABREVIATURAS);
  const amortiguadores = {
    query: "amortiguadores delanteros",
    marca: "Kia",
    modelo: "Niro",
    indice,
  };

  test("BASE AMORTIGUADOR (el caso real del Niro): «la base de amortiguador»", () => {
    expect(nombreCortoRelacionada("BASE AMORTIGUADOR", amortiguadores)).toBe(
      "la base de amortiguador",
    );
  });

  test("AMORTIG POST: expande la abreviatura y el adjetivo no lleva «de»", () => {
    expect(nombreCortoRelacionada("AMORTIG POST", amortiguadores)).toBe(
      "el amortiguador posterior",
    );
  });

  test("POLEA BOMBA AGUA E HIDRAU sigue siendo «la polea»", () => {
    expect(nombreCortoRelacionada("POLEA BOMBA AGUA E HIDRAU", bomba)).toBe("la polea");
  });

  test("TERMOSTATO ARMADO Y TAPAS se corta en el conector", () => {
    expect(nombreCortoRelacionada("TERMOSTATO ARMADO Y TAPAS", bomba)).toBe("el termostato armado");
  });

  test("BOMBA DE AGUA (empaque) sigue siendo «el empaque»", () => {
    expect(nombreCortoRelacionada("BOMBA DE AGUA (empaque)", bomba)).toBe("el empaque");
  });

  test.each([
    ["TAPA RADIADOR", "la tapa de radiador"],
    ["EMPAQUE CULATA", "el empaque de culata"],
    ["MANG RADIADOR", "la manguera de radiador"],
    ["RULIM RUEDA", "el rulimán de rueda"],
    ["BOCIN BARRA", "el bocín de barra"],
    ["CHAQUETA CREMALLERA", "la chaqueta de cremallera"],
    ["SENSOR TEMPERATURA", "el sensor de temperatura"],
    ["BOMBA AGUA", "la bomba de agua"],
    ["POLEA TENSORA", "la polea tensora"],
  ])("%s -> %s", (categoria, esperado) => {
    expect(nombreCortoRelacionada(categoria, { ...termostato, indice })).toBe(esperado);
  });

  test("una palabra fuera de la tabla: artículo por la terminación", () => {
    expect(nombreCortoRelacionada("CREMALLERA", termostato)).toBe("la cremallera");
    expect(nombreCortoRelacionada("ALTERNADOR", termostato)).toBe("el alternador");
  });
});

describe("formatearPrecio", () => {
  test("coma decimal, dos decimales y puntos de miles", () => {
    expect(formatearPrecio(89.55)).toBe("$89,55");
    expect(formatearPrecio(90)).toBe("$90,00");
    expect(formatearPrecio(1234.5)).toBe("$1.234,50");
  });
});

describe("lineaDeOpcion", () => {
  test("marca, procedencia, lado en minúscula y precio", () => {
    expect(
      lineaDeOpcion({ marca: "MANDO", procedencia: "Korea", lado: "izquierdo", precio: 89.55 }),
    ).toBe("MANDO (Korea) izquierdo $89,55");
  });

  test("sin lado", () => {
    expect(lineaDeOpcion({ marca: "MOBIS", procedencia: "Original", precio: 96.66 })).toBe(
      "MOBIS (Original) $96,66",
    );
  });

  test("sin marca: la procedencia sola", () => {
    expect(lineaDeOpcion({ procedencia: "China", lado: "derecho", precio: 25.9 })).toBe(
      "China derecho $25,90",
    );
  });

  test("sin procedencia: la marca sola, sin paréntesis", () => {
    expect(lineaDeOpcion({ marca: "TAIHO", precio: 30.4 })).toBe("TAIHO $30,40");
  });

  test("sin marca ni procedencia: solo el lado y el precio", () => {
    expect(lineaDeOpcion({ lado: "izquierdo", precio: 10 })).toBe("Izquierdo $10,00");
    expect(lineaDeOpcion({ precio: 10 })).toBe("$10,00");
  });
});

describe("textoCotizacion", () => {
  test("encabezado, una línea por opción y la línea de relacionadas", () => {
    expect(
      textoCotizacion(
        "Amortiguadores delanteros Niro 2020 (IVA incluido):",
        [
          { marca: "MANDO", procedencia: "Korea", lado: "izquierdo", precio: 89.55 },
          { marca: "MANDO", procedencia: "Korea", lado: "derecho", precio: 94.22 },
        ],
        "Si necesita la base de amortiguador, también dispongo. ¿Desea que le cotice?",
      ),
    ).toBe(
      [
        "Amortiguadores delanteros Niro 2020 (IVA incluido):",
        "MANDO (Korea) izquierdo $89,55",
        "MANDO (Korea) derecho $94,22",
        "Si necesita la base de amortiguador, también dispongo. ¿Desea que le cotice?",
      ].join("\n"),
    );
  });

  test("sin relacionadas no hay línea final y las líneas repetidas se juntan", () => {
    const o = { marca: "MOBIS", procedencia: "Original", precio: 96.66 };
    expect(textoCotizacion("Bomba de agua Accent 2006 (IVA incluido):", [o, o], null)).toBe(
      "Bomba de agua Accent 2006 (IVA incluido):\nMOBIS (Original) $96,66",
    );
  });
});
