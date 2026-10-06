import { describe, expect, test } from "vitest";
import { filasErpDesdeCsv, lotes } from "../../../scripts/erp/filas-desde-csv.mjs";

const ENCABEZADO =
  "no_item;codigo;otros_codigos;n_grupo;grupo;descripcion;descripcion_auxiliar;existencias_total;precio_matriz;precio_magdalena;precio_koreanos;precio_sas_repuestos;codigo_difiere";

function csv(...filas: string[]): string {
  return `﻿${[ENCABEZADO, ...filas].join("\r\n")}\r\n`;
}

describe("filasErpDesdeCsv", () => {
  test("una fila real del ERP sale con la forma del contrato", () => {
    // Fila 7 del export del 2026-10-05.
    const r = filasErpDesdeCsv(
      csv(
        "7;AU0826-1LL;43210-8H300;162;RULIMANES RD/RP;NS XTRAIL 2.0 4*2 T30 QR20 RP;38*79*45 NTN;0;;40.5;12.29;;si",
      ),
    );
    expect(r.errores).toEqual([]);
    expect(r.filas).toEqual([
      {
        no_item: "7",
        codigo: "AU0826-1LL",
        otros_codigos: "43210-8H300",
        n_grupo: "162",
        grupo: "RULIMANES RD/RP",
        descripcion: "NS XTRAIL 2.0 4*2 T30 QR20 RP",
        descripcion_auxiliar: "38*79*45 NTN",
        existencias_total: 0,
        precio_matriz: null,
        precio_magdalena: 40.5,
        precio_koreanos: 12.29,
        precio_sas_repuestos: null,
        codigo_difiere: "si",
      },
    ]);
  });

  test("campo entre comillas con comillas dobladas y punto y coma", () => {
    const r = filasErpDesdeCsv(
      csv(
        '535;30611-N0125;;129;KIT PRINC EMBRAG;"DT NS CABSTAR -82  DTS 5/8""";SK-1165;0;;4.29;;;no',
      ),
    );
    expect(r.filas[0]?.descripcion).toBe('DT NS CABSTAR -82  DTS 5/8"');
  });

  test("le saca el apóstrofo que el export pone delante de = + - @", () => {
    const r = filasErpDesdeCsv(
      csv("390;MS-1227A/2;;025;CHAQ BANCADA ;NS TIIDA /2;'+20;1;;28.58;;;no"),
    );
    expect(r.filas[0]?.descripcion_auxiliar).toBe("+20");
    // El blanco del final del grupo se deja: lo recorta la base.
    expect(r.filas[0]?.grupo).toBe("CHAQ BANCADA ");
  });

  test("un apóstrofo delante de otra cosa se respeta", () => {
    const r = filasErpDesdeCsv(csv("1;'A;;1;G;D;'x;0;;;;;no"));
    expect(r.filas[0]?.codigo).toBe("'A");
    expect(r.filas[0]?.descripcion_auxiliar).toBe("'x");
  });

  test("existencias y precios con decimales largos pasan como número", () => {
    const r = filasErpDesdeCsv(csv("111;X;;306;G;D;;33570.7401;22.5542857142857;0;;;no"));
    expect(r.filas[0]).toMatchObject({
      existencias_total: 33570.7401,
      precio_matriz: 22.5542857142857,
      precio_magdalena: 0,
      precio_koreanos: null,
    });
  });

  test("un número que no es número es error de esa línea y la fila no sale", () => {
    const r = filasErpDesdeCsv(csv("1;X;;1;G;D;;abc;;;;;no", "2;Y;;1;G;D;;3;1,5;;;;no"));
    expect(r.filas).toEqual([]);
    expect(r.errores).toEqual([
      { linea: 2, motivo: "existencias_total no es un número: abc" },
      { linea: 3, motivo: "precio_matriz no es un número: 1,5" },
    ]);
  });

  test("un encabezado distinto se rechaza entero", () => {
    expect(() => filasErpDesdeCsv("no_item;codigo\r\n1;X\r\n")).toThrow(/encabezado/);
  });
});

describe("lotes", () => {
  test("parte en lotes del tamaño pedido", () => {
    const xs = Array.from({ length: 12 }, (_, i) => i);
    expect(lotes(xs, 5)).toEqual([
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
      [10, 11],
    ]);
    expect(lotes([], 5)).toEqual([]);
  });
});
