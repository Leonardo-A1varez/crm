import { describe, expect, test } from "vitest";
import { filasDesdeCsv } from "../../../scripts/catalogo/modelos-desde-csv.mjs";

const ENCABEZADO =
  "marca_sigla,marca,modelo_en_catalogo,tipo,filas,MODELO_REAL_ESCRIBIR_ACA,MODELO_SUGERIDO,CONFIANZA,POR_QUE,CONFIRMADO";

function csv(...filas: string[]): string {
  return [ENCABEZADO, ...filas].join("\n");
}

describe("filasDesdeCsv", () => {
  test("una sugerencia sin tocar entra con su confianza y sin confirmar", () => {
    const r = filasDesdeCsv(csv("HY,Hyundai,ACC,modelo,1248,,Hyundai Accent,alta,porque,"));
    expect(r.filas).toEqual([
      {
        marca: "Hyundai",
        sigla_modelo: "ACC",
        nombre_real: "Hyundai Accent",
        confianza: "alta",
        confirmado: false,
      },
    ]);
  });

  test("lo que el dueño escribió gana sobre la sugerencia y cuenta como confirmado", () => {
    const r = filasDesdeCsv(
      csv("HY,Hyundai,STA FE,modelo,1033,Hyundai Santa Fe,Hyundai Sta Fe,media,porque,"),
    );
    expect(r.filas[0]).toMatchObject({
      nombre_real: "Hyundai Santa Fe",
      confirmado: true,
      confianza: "media",
    });
  });

  test.each(["SI", "sí", "Si", "si", "x", "OK"])(
    "CONFIRMADO=%s confirma la sugerencia",
    (marca) => {
      const r = filasDesdeCsv(
        csv(`CH,Chevrolet,COR,modelo,10,,Chevrolet Corsa,media,porque,${marca}`),
      );
      expect(r.filas[0]).toMatchObject({
        nombre_real: "Chevrolet Corsa",
        confirmado: true,
        confianza: "media",
      });
    },
  );

  test("CONFIRMADO con un nombre confirma y es el nombre real", () => {
    const r = filasDesdeCsv(
      csv("CH,Chevrolet,COR,modelo,10,,Chevrolet Corsa,media,porque,Chevrolet Corsa Wind"),
    );
    expect(r.filas[0]).toMatchObject({ nombre_real: "Chevrolet Corsa Wind", confirmado: true });
  });

  test("CONFIRMADO con un nombre le gana a lo que escribió el dueño en su columna", () => {
    const r = filasDesdeCsv(
      csv(
        "CH,Chevrolet,COR,modelo,10,Corsa viejo,Chevrolet Corsa,media,porque,Chevrolet Corsa Wind",
      ),
    );
    expect(r.filas[0]?.nombre_real).toBe("Chevrolet Corsa Wind");
  });

  test.each(["NO", "no", "No"])("CONFIRMADO=%s rechaza: queda cargada pero inactiva", (v) => {
    const r = filasDesdeCsv(csv(`CH,Chevrolet,COR,modelo,10,,Chevrolet Corsa,alta,porque,${v}`));
    expect(r.filas[0]).toMatchObject({ confirmado: false, confianza: "baja" });
    expect(r.rechazadas).toBe(1);
  });

  test("omite los alcances, lo que no es un modelo y los motores", () => {
    const r = filasDesdeCsv(
      csv(
        "CH,Chevrolet,COR TODOS,ALCANCE,5,,Chevrolet Corsa (alcance: todos),alta,porque,",
        'KIA,Kia,XCITE,modelo,5,,"Acabado, NO es un modelo",alta,porque,',
        "CH,Chevrolet,4ZD1,modelo,5,,MOTOR Isuzu 2.3,alta,porque,",
        "TY,Toyota,MZ,modelo,5,,Toyota ??? (no es un modelo claro),alta,porque,",
        "HY,Hyundai,ACC,modelo,5,,Hyundai Accent,alta,porque,",
      ),
    );
    expect(r.filas.map((f: { sigla_modelo: string }) => f.sigla_modelo)).toEqual(["ACC"]);
    expect(r.omitidas.map((o: { sigla: string }) => o.sigla)).toEqual([
      "COR TODOS",
      "XCITE",
      "4ZD1",
      "MZ",
    ]);
  });

  test("una confianza desconocida cuenta como baja", () => {
    const r = filasDesdeCsv(csv("HY,Hyundai,ACC,modelo,5,,Hyundai Accent,quizás,porque,"));
    expect(r.filas[0]?.confianza).toBe("baja");
  });

  test("las filas sin marca, sigla o nombre se omiten", () => {
    const r = filasDesdeCsv(
      csv(
        ",,ACC,modelo,5,,Hyundai Accent,alta,p,",
        "HY,Hyundai,,modelo,5,,Hyundai Accent,alta,p,",
        "HY,Hyundai,ACC,modelo,5,,,alta,p,",
      ),
    );
    expect(r.filas).toEqual([]);
    expect(r.omitidas).toHaveLength(3);
  });

  test("una (marca, sigla) repetida se carga una vez y se avisa", () => {
    const r = filasDesdeCsv(
      csv(
        "HY,Hyundai,ACC,modelo,5,,Hyundai Accent,alta,p,",
        "HY,Hyundai,ACC,modelo,5,,Hyundai Otro,alta,p,",
      ),
    );
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]?.nombre_real).toBe("Hyundai Accent");
    expect(r.duplicadas).toEqual([{ marca: "Hyundai", sigla: "ACC" }]);
  });

  test("tolera el BOM y los saltos de línea de Windows", () => {
    const r = filasDesdeCsv(
      `﻿${ENCABEZADO}\r\nHY,Hyundai,ACC,modelo,5,,Hyundai Accent,alta,p,\r\n`,
    );
    expect(r.filas).toHaveLength(1);
  });

  test("el resumen cuenta las que entran a la búsqueda", () => {
    const r = filasDesdeCsv(
      csv(
        "HY,Hyundai,ACC,modelo,5,,Hyundai Accent,alta,p,",
        "CH,Chevrolet,COR,modelo,5,,Chevrolet Corsa,media,p,",
        "CH,Chevrolet,SAIL,modelo,5,,Chevrolet Sail,baja,p,SI",
      ),
    );
    expect(r.resumen).toEqual({ total: 3, activas: 2, inactivas: 1 });
  });

  test("tira si el CSV no trae las columnas esperadas", () => {
    expect(() => filasDesdeCsv("a,b\n1,2")).toThrow(/columnas/);
  });
});
