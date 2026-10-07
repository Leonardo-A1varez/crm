import { describe, expect, test } from "vitest";
import {
  encabezadoCotizacion,
  nombreCortoRelacionada,
  textoRelacionadas,
} from "@/lib/catalogo/formato-cotizacion";

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
