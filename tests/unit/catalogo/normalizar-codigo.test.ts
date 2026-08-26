import { describe, expect, test } from "vitest";
import { normalizarCodigo, plegarCodigo } from "@/lib/catalogo/normalizar-codigo";

/*
 * El catálogo real pega dos cosas sobre el número de fábrica: la MEDIDA
 * (`/STD`, `/0.50`, `/1.00`) y el ORIGEN (`/ORG` genuino, `/K` Corea, `/CH`
 * China, `/JP` Japón). Un taller que dicta el número grabado en la pieza dicta
 * `96389106`, nunca `96389106/STD/K`. Sin pelar esos sufijos la búsqueda por
 * código —que es la que cierra la venta más rápido— falla contra el 7% del
 * catálogo que los lleva, y contra el 100% de los que llevan origen.
 */
describe("normalizarCodigo", () => {
  test("pela el sufijo de medida y el de origen", () => {
    expect(normalizarCodigo("96389106/STD/K")).toBe("96389106");
    expect(normalizarCodigo("23041-2B101/STD/ORG")).toBe("23041-2B101");
  });

  test("conserva los guiones del número de fábrica", () => {
    // `8-97037-801-0` es un número Isuzu completo: sacarle los guiones acá
    // rompería lo que se muestra en pantalla y en la cotización.
    expect(normalizarCodigo("8-97037-801-0/0.75")).toBe("8-97037-801-0");
  });

  test("la medida también viene separada por espacio", () => {
    expect(normalizarCodigo("93740421 0.50")).toBe("93740421");
  });

  test("tolera el guión colgado que dejó la carga a mano", () => {
    // Existe tal cual en el catálogo: `8-97037-801-0/0.75-`.
    expect(normalizarCodigo("8-97037-801-0/0.75-")).toBe("8-97037-801-0");
  });

  test("no pela un segmento que no es medida ni origen", () => {
    // `112U` es parte del número, no un sufijo. Pelarlo perdería la pieza.
    expect(normalizarCodigo("TY-574/112U")).toBe("TY-574/112U");
    expect(normalizarCodigo("0K2Y4-11-SAO")).toBe("0K2Y4-11-SAO");
  });

  test("sube a mayúscula y recorta", () => {
    expect(normalizarCodigo("  96389106/std/k  ")).toBe("96389106");
  });

  test("pela sufijos encadenados desde el final", () => {
    // `JAPON`, `NPR` e `IZU` son marcas de procedencia igual que `K` o `CH`.
    expect(normalizarCodigo("40172/STD/JAPON")).toBe("40172");
    expect(normalizarCodigo("SDL-03079/0.25/NPR")).toBe("SDL-03079");
    expect(normalizarCodigo("22311-04020/K/MET")).toBe("22311-04020");
  });

  test("deja de pelar apenas encuentra algo que no es sufijo", () => {
    /*
     * Regla deliberada: se pela SOLO desde el final. La función gemela en SQL
     * (`public.plegar_codigo`) no puede filtrar segmentos del medio sin volverse
     * ilegible, y dos espejos que divergen es peor que un espejo tosco — es
     * exactamente la trampa que ya advierte la migración de `buscar_productos`.
     * Medido: 9 códigos sobre 25.429 caen acá, y son basura de carga a mano.
     */
    expect(normalizarCodigo("93743633/ORG/14*10)")).toBe("93743633/ORG/14*10)");
  });

  test("descarta el segmento vacío que dejó una barra colgada", () => {
    expect(normalizarCodigo("9-33265-620-0/JP/")).toBe("9-33265-620-0");
  });

  test("una cadena sin nada devuelve vacío", () => {
    expect(normalizarCodigo("")).toBe("");
    expect(normalizarCodigo("   ")).toBe("");
  });
});

/*
 * `plegarCodigo` es la clave con la que se indexa y se busca. Medido sobre las
 * 21.009 filas reales: plegar los separadores produce 16 colisiones sobre
 * 16.995 claves, y las 16 son el MISMO código escrito de dos formas
 * (`D-905` vs `D905`). O sea que plegar no confunde piezas: unifica el tipeo.
 */
describe("plegarCodigo", () => {
  test("las dos formas del mismo código caen en la misma clave", () => {
    expect(plegarCodigo("D-905")).toBe(plegarCodigo("D905"));
    expect(plegarCodigo("12860-82600")).toBe(plegarCodigo("1286082600"));
  });

  test("pliega después de pelar los sufijos", () => {
    expect(plegarCodigo("23041-2B101/STD/ORG")).toBe("230412B101");
  });

  test("el cliente que dicta sin guiones encuentra la fila", () => {
    expect(plegarCodigo("8972317180")).toBe(plegarCodigo("8-97231-718-0"));
  });

  test("una cadena sin alfanuméricos queda vacía", () => {
    expect(plegarCodigo("---")).toBe("");
    expect(plegarCodigo("")).toBe("");
  });
});
