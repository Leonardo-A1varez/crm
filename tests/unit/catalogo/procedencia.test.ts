import { describe, expect, test } from "vitest";
import {
  etiquetaDeOrigen,
  indexarMarcas,
  procedenciaDe,
  resolverOrigen,
} from "@/lib/catalogo/procedencia";
import { MARCAS } from "../../helpers/catalogo-marcas-fixtures";

describe("procedenciaDe", () => {
  test.each([
    ["MOBIS", "MOBIS"],
    ["KOREA", "KOREA"],
    ["CHINA", "CHINA"],
    ["GM", "GM"],
    ["  mobis ", "MOBIS"],
    ["KIA AE", "KIA AE"],
    ["SUPER-MAX", "SUPER-MAX"],
    ["HY INDIA", "HY INDIA"],
  ])("%j es un texto de marca o procedencia: %j", (entrada, esperada) => {
    expect(procedenciaDe(entrada)).toBe(esperada);
  });

  // Los valores de abajo existen en `productos.descripcion` del catálogo real
  // (consulta por frecuencia, 2026-10-07): medidas, sobremedidas y restos.
  test.each([
    "52*88C",
    "54*82C",
    "54*88°",
    "555",
    "+20",
    "0",
    "A2(b) 7  C/U",
    "C/U",
    "STD",
    "",
    "   ",
  ])("%j parece basura, no una marca ni una procedencia", (entrada) => {
    expect(procedenciaDe(entrada)).toBeNull();
  });

  test("null y undefined no tienen procedencia", () => {
    expect(procedenciaDe(null)).toBeNull();
    expect(procedenciaDe(undefined)).toBeNull();
  });
});

describe("resolverOrigen", () => {
  const indice = indexarMarcas(MARCAS);
  const r = (descripcion: string | null, codigo: string | null = null) =>
    resolverOrigen(descripcion, codigo, indice);

  describe("1. la descripción es un país: es la procedencia y no hay marca", () => {
    test.each([
      ["CHINA", "China"],
      ["KOREA", "Korea"],
      ["KOREANO", "Korea"],
      ["JAPON", "Japón"],
      ["JAPAN", "Japón"],
      ["COLOMBIA", "Colombia"],
      ["INDIA", "India"],
      ["HY INDIA", "India"],
      ["TAIWAN", "Taiwán"],
      ["ALEMANIA", "Alemania"],
      ["FRANCIA", "Francia"],
      ["  korea ", "Korea"],
    ])("%j", (entrada, procedencia) => {
      expect(r(entrada)).toEqual({ marca: null, procedencia });
    });

    test("un país gana sobre el sufijo del código", () => {
      expect(r("KOREA", "12345/JP")).toEqual({ marca: null, procedencia: "Korea" });
    });
  });

  describe("2. la descripción es una marca del catálogo (nombre o alias)", () => {
    test.each([
      ["MOBIS", "MOBIS", "Original"],
      ["mobis", "MOBIS", "Original"],
      ["GM", "GM", "Original"],
      ["HMC", "HMC", "Original"],
      ["MANDO", "MANDO", "Korea"],
      ["JUNGWOO", "JUNGWOO", "Korea"],
      ["CTR", "CTR", "Korea"],
      ["DONGSUNG", "DONGSUNG", "Korea"],
      ["AISIN", "AISIN", "Japón"],
      ["SEIWA", "SEIWA", "Japón"],
      ["VALEO", "VALEO", "Francia"],
      ["BOSCH", "BOSCH", "Alemania"],
      ["KRC", "KRC", "China"],
      ["PRO-AUT", "PRO-AUT", "China"],
    ])("%j es la marca %j de procedencia %j", (entrada, marca, procedencia) => {
      expect(r(entrada)).toEqual({ marca, procedencia });
    });

    test("un número puede ser el nombre de una marca (555 es japonesa)", () => {
      expect(r("555")).toEqual({ marca: "555", procedencia: "Japón" });
    });

    test("el alias resuelve al nombre canónico, sin importar mayúsculas ni blancos", () => {
      expect(r("hyundai   mobis")).toEqual({ marca: "MOBIS", procedencia: "Original" });
      expect(r("Jung Woo")).toEqual({ marca: "JUNGWOO", procedencia: "Korea" });
    });

    test("una marca sin procedencia cargada queda sin procedencia", () => {
      expect(r("TAIHO")).toEqual({ marca: "TAIHO", procedencia: null });
    });

    test("una marca inactiva no se usa: es un texto desconocido", () => {
      expect(r("VIEJA")).toEqual({ marca: "VIEJA", procedencia: null });
    });

    test("el nombre de una marca gana sobre el alias de otra", () => {
      const i = indexarMarcas([
        { nombre: "AAA", tipo: null, procedencia: "CHINA", activa: true, alias: ["BBB"] },
        { nombre: "BBB", tipo: null, procedencia: "KOREA", activa: true, alias: [] },
      ]);
      expect(resolverOrigen("BBB", null, i)).toEqual({ marca: "BBB", procedencia: "Korea" });
    });

    test("la procedencia de la marca gana sobre el sufijo del código", () => {
      expect(r("MANDO", "12345/JP")).toEqual({ marca: "MANDO", procedencia: "Korea" });
    });

    test("una marca sin procedencia la toma del sufijo del código si lo trae", () => {
      expect(r("TAIHO", "12345/JP")).toEqual({ marca: "TAIHO", procedencia: "Japón" });
    });
  });

  describe("3. el sufijo del código señala la procedencia", () => {
    test.each([
      ["25100-2X000/K", "Korea"],
      ["25100-2X000/KR", "Korea"],
      ["25100-2X000/JP", "Japón"],
      ["25100-2X000/FR", "Francia"],
      ["25100-2X000/DE", "Alemania"],
      ["25100-2X000/CH", "China"],
      ["25100-2X000/ORG", "Original"],
      ["25100-2X000/ch", "China"],
      ["25100-2X000/TW", "Taiwán"],
    ])("%j sin descripción útil: %j", (codigo, procedencia) => {
      expect(r("52*88C", codigo)).toEqual({ marca: null, procedencia });
      expect(r(null, codigo)).toEqual({ marca: null, procedencia });
    });

    test("pela primero la medida: el sufijo de origen puede ir antes", () => {
      expect(r(null, "25100-2X000/K/0.50")).toEqual({ marca: null, procedencia: "Korea" });
      expect(r(null, "25100-2X000/ORG/STD")).toEqual({ marca: null, procedencia: "Original" });
    });

    test("texto de marca desconocida + sufijo: la marca y la procedencia del código", () => {
      expect(r("NUEVAMARCA", "25100-2X000/K")).toEqual({
        marca: "NUEVAMARCA",
        procedencia: "Korea",
      });
    });

    test("una letra pegada con guion o un código sin barra no es un sufijo", () => {
      expect(r(null, "25100-K")).toEqual({ marca: null, procedencia: null });
      expect(r(null, "K")).toEqual({ marca: null, procedencia: null });
    });

    test("un segmento que no es un origen conocido no inventa nada", () => {
      expect(r(null, "25100-2X000/XYZ")).toEqual({ marca: null, procedencia: null });
      expect(r(null, "25100-2X000/STD")).toEqual({ marca: null, procedencia: null });
    });
  });

  describe("4. si no hay más, solo la marca; nunca se inventa la procedencia", () => {
    test("texto de marca desconocida sin sufijo", () => {
      expect(r("NUEVAMARCA")).toEqual({ marca: "NUEVAMARCA", procedencia: null });
      expect(r("KIA AE")).toEqual({ marca: "KIA AE", procedencia: null });
    });

    test.each([null, undefined, "", "   ", "52*88C", "+20", "STD", "C/U"])(
      "%j sin código: ni marca ni procedencia",
      (d) => {
        expect(r(d as string | null)).toEqual({ marca: null, procedencia: null });
      },
    );
  });

  test("con la tabla de marcas vacía el país y el sufijo siguen funcionando", () => {
    const vacio = indexarMarcas([]);
    expect(resolverOrigen("MOBIS", null, vacio)).toEqual({ marca: "MOBIS", procedencia: null });
    expect(resolverOrigen("CHINA", null, vacio)).toEqual({ marca: null, procedencia: "China" });
    expect(resolverOrigen(null, "1234/K", vacio)).toEqual({ marca: null, procedencia: "Korea" });
  });
});

describe("etiquetaDeOrigen: cómo se presenta al cliente", () => {
  test.each([
    [{ marca: "MOBIS", procedencia: "Original" }, "MOBIS (Original)"],
    [{ marca: "JUNGWOO", procedencia: "Korea" }, "JUNGWOO (Korea)"],
    [{ marca: null, procedencia: "China" }, "China"],
    [{ marca: "TAIHO", procedencia: null }, "TAIHO"],
    [{ marca: null, procedencia: null }, null],
  ])("%j -> %j", (origen, etiqueta) => {
    expect(etiquetaDeOrigen(origen)).toBe(etiqueta);
  });
});
