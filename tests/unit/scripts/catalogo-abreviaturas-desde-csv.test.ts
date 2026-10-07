import { describe, expect, test } from "vitest";
import { filasDesdeCsv } from "../../../scripts/catalogo/abreviaturas-desde-csv.mjs";

const ENCABEZADO = "abrev,expansion,tipo,ambito,filas,ejemplos_reales,confianza,por_que,CONFIRMADO";

function csv(...filas: string[]): string {
  return [ENCABEZADO, ...filas].join("\n");
}

describe("filasDesdeCsv (abreviaturas)", () => {
  test("una sugerencia con confianza alta entra activa sin confirmar", () => {
    const r = filasDesdeCsv(csv("AMORTIG,amortiguador,pieza,categoria,796,ej,alta,porque,"));
    expect(r.filas).toEqual([
      {
        abrev: "AMORTIG",
        expansion: "amortiguador",
        tipo: "pieza",
        ambito: "categoria",
        confianza: "alta",
        confirmado: false,
      },
    ]);
    expect(r.resumen).toEqual({ total: 1, activas: 1, inactivas: 0 });
  });

  test("media y baja esperan confirmación", () => {
    const r = filasDesdeCsv(
      csv(
        "POS,posterior,posicion,nombre,43,ej,media,x,",
        "EMG,emergencia,ruido,categoria,5,ej,baja,x,",
      ),
    );
    expect(r.resumen).toEqual({ total: 2, activas: 0, inactivas: 2 });
  });

  test.each(["SI", "sí", "x", "OK"])("CONFIRMADO=%s confirma la sugerencia", (marca) => {
    const r = filasDesdeCsv(csv(`POS,posterior,posicion,nombre,43,ej,media,x,${marca}`));
    expect(r.filas[0]).toMatchObject({
      confirmado: true,
      confianza: "media",
      expansion: "posterior",
    });
    expect(r.resumen.activas).toBe(1);
  });

  test("un texto en CONFIRMADO corrige la expansión y confirma", () => {
    const r = filasDesdeCsv(csv("SEN,sensor,pieza,categoria,757,ej,media,x,sensor eléctrico"));
    expect(r.filas[0]).toMatchObject({ expansion: "sensor eléctrico", confirmado: true });
  });

  test("NO rechaza: queda inactiva aunque la sugerencia fuera alta", () => {
    const r = filasDesdeCsv(csv("SEN,sensor,pieza,categoria,757,ej,alta,x,NO"));
    expect(r.filas[0]).toMatchObject({ confirmado: false, confianza: "baja" });
    expect(r.rechazadas).toBe(1);
    expect(r.resumen.activas).toBe(0);
  });

  test("DEL como posición y DEL como ruido son dos filas; la repetida exacta se descarta", () => {
    const r = filasDesdeCsv(
      csv(
        "DEL,delantero (en el nombre),posicion,nombre,266,ej,media,x,",
        "DEL,«del» (preposición),ruido,categoria,131,ej,alta,x,",
        "DEL,otra vez,posicion,nombre,1,ej,alta,x,",
      ),
    );
    expect(r.filas.map((f) => `${f.abrev}/${f.tipo}`)).toEqual(["DEL/posicion", "DEL/ruido"]);
    expect(r.duplicadas).toEqual([{ abrev: "DEL", tipo: "posicion" }]);
  });

  test("una expansión con aclaración entre paréntesis se guarda entera", () => {
    const r = filasDesdeCsv(csv("POST,posterior (trasero),posicion,ambos,1789,ej,alta,x,"));
    expect(r.filas[0]?.expansion).toBe("posterior (trasero)");
  });

  test("tipo o ámbito desconocidos y filas vacías se omiten con el motivo", () => {
    const r = filasDesdeCsv(
      csv(
        "AAA,cosa,rara,ambos,1,ej,alta,x,",
        "BBB,cosa,pieza,lejos,1,ej,alta,x,",
        ",cosa,pieza,ambos,1,ej,alta,x,",
        "CCC,,pieza,ambos,1,ej,alta,x,",
      ),
    );
    expect(r.filas).toHaveLength(0);
    expect(r.omitidas.map((o) => o.motivo)).toEqual([
      "tipo desconocido: rara",
      "ámbito desconocido: lejos",
      "falta la abreviatura o su expansión",
      "falta la abreviatura o su expansión",
    ]);
  });

  test("el BOM del principio no rompe las columnas", () => {
    const r = filasDesdeCsv("﻿" + csv("AMORTIG,amortiguador,pieza,categoria,796,ej,alta,x,"));
    expect(r.filas).toHaveLength(1);
  });

  test("sin las columnas obligatorias falla con un mensaje claro", () => {
    expect(() => filasDesdeCsv("a,b\n1,2")).toThrow(
      /faltan abrev, expansion, tipo, ambito, confianza/,
    );
  });
});
