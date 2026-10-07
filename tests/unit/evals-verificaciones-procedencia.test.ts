import { describe, expect, test } from "vitest";
import type { BuscarRepuestoMatch } from "@/lib/validation/ai";
import type { ResultadoTurno } from "../evals/agente/casos";
import {
  citaOpcion,
  citaProcedenciaConPrecio,
  cotizaConFormato,
  noCitaPrecios,
  noDiceOriginal,
  noRepregunta,
  preguntaPieza,
  sinCodigosDeProducto,
  sinRangoDePrecios,
  tratoDeUsted,
} from "../evals/agente/verificaciones";

// Las verificaciones del eval son regex sobre texto: un falso positivo cuesta una
// corrida de OpenAI y una falla que no es del agente. Se prueban acá, sin red.

const catalogo: BuscarRepuestoMatch[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    codigo_interno: "9015",
    nombre: "X",
    precio: 6.93,
    stock: 1,
  },
];
const turno = (texto: string): ResultadoTurno => ({ texto, busquedas: [], catalogo, turno: [] });

describe("preguntaPieza", () => {
  test("pasa si pregunta y ofrece suelta, base/tapa y conjunto", () => {
    expect(
      preguntaPieza()(turno("¿Necesitás solo el termostato, la base/tapa o el conjunto completo?")),
    ).toBeNull();
  });
  test("falla si no pregunta", () => {
    expect(preguntaPieza()(turno("Tengo el conjunto completo y la base."))).not.toBeNull();
  });
  test("falla si pregunta otra cosa", () => {
    expect(preguntaPieza()(turno("¿De qué año es tu Accent?"))).not.toBeNull();
  });
});

describe("sinRangoDePrecios", () => {
  test.each([
    "Va de entre $5,77 y $40,53 IVA incluido",
    "Desde $5.77 hasta $40.53",
    "Cuesta $5,77 a $40,53",
    "Tengo un rango de precios",
    "$5,77 - $40,53",
  ])("falla con %j", (t) => {
    expect(sinRangoDePrecios()(turno(t))).not.toBeNull();
  });
  test.each([
    "Termostato Accent 1.6 2006: MOBIS $12,96 · KOREA $6,93 (IVA incluido)",
    "MOBIS $12,96 - KOREA $6,93",
    "MOBIS $12,96 y KOREA $6,93",
  ])("pasa con %j", (t) => {
    expect(sinRangoDePrecios()(turno(t))).toBeNull();
  });
});

describe("citaProcedenciaConPrecio", () => {
  test.each(["MOBIS $12,96", "MOBIS: $12,96 IVA incluido", "$12.96 MOBIS", "mobis 12,96"])(
    "pasa con %j",
    (t) => {
      expect(citaProcedenciaConPrecio("MOBIS", 12.96)(turno(t))).toBeNull();
    },
  );
  test("falla si el precio es de otra procedencia", () => {
    expect(
      citaProcedenciaConPrecio("MOBIS", 12.96)(turno("MOBIS $6,93 · KOREA $12,96")),
    ).not.toBeNull();
  });
  test("falla si no la nombra", () => {
    expect(citaProcedenciaConPrecio("MOBIS", 12.96)(turno("Cuesta $12,96"))).not.toBeNull();
  });
});

describe("noCitaPrecios, sinCodigosDeProducto, noDiceOriginal", () => {
  test("noCitaPrecios detecta un precio ajeno", () => {
    expect(noCitaPrecios([40.53], "el conjunto")(turno("El conjunto: $40,53"))).not.toBeNull();
    expect(noCitaPrecios([40.53], "el conjunto")(turno("MOBIS $12,96"))).toBeNull();
  });
  test("sinCodigosDeProducto detecta el código como token", () => {
    expect(sinCodigosDeProducto()(turno("Es el 9015, KOREA $6,93"))).not.toBeNull();
    expect(sinCodigosDeProducto()(turno("KOREA $6,93 (código 9015)"))).not.toBeNull();
    expect(sinCodigosDeProducto()(turno("KOREA $6,93"))).toBeNull();
  });
  test("noDiceOriginal", () => {
    expect(noDiceOriginal()(turno("MOBIS (original) $12,96"))).not.toBeNull();
    expect(noDiceOriginal()(turno("MOBIS $12,96"))).toBeNull();
  });
});

const COTIZACION = [
  "Bomba de agua Accent 2006 (IVA incluido):",
  "JUNGWOO (Korea) $22,01",
  "MOBIS (Original) $66,18",
  "Si necesita la polea o el empaque, también dispongo. ¿Desea que le cotice?",
].join("\n");

describe("cotizaConFormato: encabezado, una opción por línea, IVA una sola vez", () => {
  test("pasa con la cotización del dueño, con o sin la línea de relacionadas", () => {
    expect(cotizaConFormato()(turno(COTIZACION))).toBeNull();
    expect(cotizaConFormato()(turno(COTIZACION.split("\n").slice(0, 3).join("\n")))).toBeNull();
  });

  test.each([
    ["la primera línea no es el encabezado", "JUNGWOO (Korea) $22,01\nMOBIS (Original) $66,18"],
    [
      "repite el IVA en cada opción",
      "Bomba de agua Accent 2006 (IVA incluido):\nJUNGWOO (Korea) $22,01 (IVA incluido)",
    ],
    [
      "junta las opciones en una línea",
      "Bomba de agua Accent 2006 (IVA incluido):\nJUNGWOO (Korea) $22,01 · MOBIS (Original) $66,18",
    ],
  ])("falla si %s", (_n, t) => {
    expect(cotizaConFormato()(turno(t))).not.toBeNull();
  });
});

describe("tratoDeUsted", () => {
  test("pasa con la cotización y con formas de usted", () => {
    expect(tratoDeUsted()(turno(COTIZACION))).toBeNull();
    expect(tratoDeUsted()(turno("¿Desea que le confirme el año de su Accent?"))).toBeNull();
  });

  test.each([
    "¿Querés que te la cotice?",
    "Confirmame el año",
    "¿Necesitás la bomba?",
    "¿De qué año es tu Accent?",
    "¿Te lo cotizo?",
    "Contame el modelo",
  ])("falla con %j", (t) => {
    expect(tratoDeUsted()(turno(t))).not.toBeNull();
  });
});

describe("noRepregunta: la línea de piezas relacionadas no es una repregunta", () => {
  test("pasa con el cierre «Si necesita la polea…» y falla con una repregunta de verdad", () => {
    expect(noRepregunta()(turno(COTIZACION))).toBeNull();
    expect(noRepregunta()(turno("¿Necesita la bomba o la polea?"))).not.toBeNull();
  });
});

describe("citaOpcion: «MARCA (Procedencia) $precio»", () => {
  test.each([
    "Bomba de agua Kia Rio 2018: MOBIS (Original) $96,66 · JUNGWOO (Korea) $21,51 (IVA incluido)",
    "mobis (original) $96,66",
    "MOBIS (Original) 96.66",
    "MOBIS ( Original ) $96,66",
  ])("pasa con %j", (t) => {
    expect(citaOpcion("MOBIS", "Original", 96.66)(turno(t))).toBeNull();
  });

  test.each([
    ["sin los paréntesis", "MOBIS Original $96,66"],
    ["sin la procedencia", "MOBIS $96,66"],
    ["con otra procedencia", "MOBIS (Korea) $96,66"],
    ["con el precio de otra opción", "MOBIS (Original) $21,51 · JUNGWOO (Korea) $96,66"],
    ["sin el precio", "MOBIS (Original) con IVA"],
  ])("falla %s", (_n, t) => {
    expect(citaOpcion("MOBIS", "Original", 96.66)(turno(t))).not.toBeNull();
  });
});
