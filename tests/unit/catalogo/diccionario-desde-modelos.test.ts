import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SIGLAS_DE_MARCA, diccionarioDesdeModelos } from "@/lib/catalogo/diccionario-desde-modelos";
import { cargarDiccionario, traducirDescripcion } from "@/lib/catalogo/traducir-descripcion";
import type { ModeloCatalogo } from "@/lib/catalogo/compatibilidad";

function modelo(parcial: Partial<ModeloCatalogo>): ModeloCatalogo {
  return {
    marca: "Hyundai",
    sigla_modelo: "ACC",
    nombre_real: "Hyundai Accent",
    alias: [],
    confianza: "alta",
    confirmado: false,
    ...parcial,
  };
}

describe("diccionarioDesdeModelos", () => {
  it("convierte filas de catalogo_modelos en entradas del traductor", () => {
    const dic = diccionarioDesdeModelos([modelo({})]);
    expect(dic).toHaveLength(1);
    expect(dic[0]).toMatchObject({
      marcaSigla: "HY",
      marca: "Hyundai",
      modeloCatalogo: "ACC",
      modeloSugerido: "Hyundai Accent",
      confianza: "alta",
      esVehiculo: true,
      compuesto: false,
    });
  });

  it("solo usa lo activo: confirmado o confianza alta", () => {
    const dic = diccionarioDesdeModelos([
      modelo({ sigla_modelo: "A", confianza: "media" }),
      modelo({ sigla_modelo: "B", confianza: "media", confirmado: true }),
      modelo({ sigla_modelo: "C", confianza: "baja" }),
      modelo({ sigla_modelo: "D", confianza: "alta" }),
    ]);
    expect(dic.map((m) => m.modeloCatalogo)).toEqual(["B", "D"]);
  });

  it("descarta una marca sin sigla conocida", () => {
    expect(diccionarioDesdeModelos([modelo({ marca: "Lada" })])).toEqual([]);
  });

  it("marca como compuesto un nombre que junta dos vehículos", () => {
    const dic = diccionarioDesdeModelos([
      modelo({
        marca: "Chevrolet",
        sigla_modelo: "SPARK",
        nombre_real: "Chevrolet Spark + Daewoo Matiz",
      }),
    ]);
    expect(dic[0]?.compuesto).toBe(true);
  });

  it("alimenta al traductor igual que el CSV", () => {
    const dic = diccionarioDesdeModelos([modelo({})]);
    const res = traducirDescripcion("HY ACC 06- 1.4 /0", dic);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      marca: "Hyundai",
      modelo: "ACC",
      modelo_nombre: "Hyundai Accent",
      anio_desde: 2006,
      cilindrada: "1.4",
    });
  });
});

describe("SIGLAS_DE_MARCA", () => {
  it("coincide con los pares sigla/marca del CSV del diccionario", () => {
    const csv = readFileSync(
      resolve(process.cwd(), "docs/catalogo/diccionario-modelos-sugerido.csv"),
      "utf8",
    );
    const pares = new Map<string, string>();
    for (const m of cargarDiccionario(csv)) pares.set(m.marca, m.marcaSigla);
    expect(Object.fromEntries(pares)).toEqual(SIGLAS_DE_MARCA);
  });
});
