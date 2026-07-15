import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import { parseProductosCsv } from "@/server/services/catalog/csv-import";

const HEADER = "codigo_interno,nombre,descripcion,categoria,precio,stock,sku_proveedor";

describe("parseProductosCsv", () => {
  test("parsea filas válidas y normaliza opcionales vacíos a null", () => {
    const csv = [
      HEADER,
      "PF-001,Pastilla freno,Juego delantero,frenos,120000.50,12,BR-123",
      "FA-002,Filtro aire,,, 8500,3,",
    ].join("\n");

    const r = parseProductosCsv(csv);
    expect(r.total).toBe(2);
    expect(r.errores).toEqual([]);
    expect(r.validos).toHaveLength(2);
    expect(r.validos[0]).toEqual({
      codigo_interno: "PF-001",
      nombre: "Pastilla freno",
      descripcion: "Juego delantero",
      categoria: "frenos",
      precio: 120000.5,
      stock: 12,
      sku_proveedor: "BR-123",
    });
    expect(r.validos[1]?.descripcion).toBeNull();
    expect(r.validos[1]?.categoria).toBeNull();
    expect(r.validos[1]?.sku_proveedor).toBeNull();
    expect(r.validos[1]?.precio).toBe(8500);
  });

  test("tolera BOM y headers con mayúsculas/espacios", () => {
    // BOM construido por charCode — un literal invisible en el source es frágil.
    const csv = String.fromCharCode(0xfeff) + "Codigo_Interno, Nombre ,precio,stock\nX-1,Prod,10,1";
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(1);
    expect(r.validos[0]?.codigo_interno).toBe("X-1");
  });

  test("columnas desconocidas se ignoran", () => {
    const csv = "codigo_interno,nombre,precio,stock,color\nX-1,Prod,10,1,rojo";
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(1);
    expect(r.validos[0]).not.toHaveProperty("color");
  });

  test("precio no numérico → error por fila con número de línea", () => {
    const csv = [HEADER, "OK-1,Prod,,,100,1,", "BAD-1,Prod,,,caro,1,"].join("\n");
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(1);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]?.fila).toBe(3);
    expect(r.errores[0]?.errores.join(" ")).toMatch(/precio/);
  });

  test("precio vacío → error (no 0 silencioso)", () => {
    const csv = [HEADER, "BAD-2,Prod,,,,1,"].join("\n");
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(0);
    expect(r.errores[0]?.errores.join(" ")).toMatch(/precio/);
  });

  test("stock decimal o negativo → error por fila", () => {
    const csv = [HEADER, "BAD-3,Prod,,,10,1.5,", "BAD-4,Prod,,,10,-2,"].join("\n");
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(0);
    expect(r.errores.map((e) => e.fila)).toEqual([2, 3]);
  });

  test("codigo_interno duplicado en archivo → segunda ocurrencia a errores", () => {
    const csv = [HEADER, "DUP-1,Prod A,,,10,1,", "DUP-1,Prod B,,,20,2,"].join("\n");
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(1);
    expect(r.validos[0]?.nombre).toBe("Prod A");
    expect(r.errores[0]?.fila).toBe(3);
    expect(r.errores[0]?.errores.join(" ")).toMatch(/duplicado/);
  });

  test("faltan headers requeridos → ValidationError", () => {
    expect(() => parseProductosCsv("codigo_interno,nombre\nX,Y")).toThrow(ValidationError);
    expect(() => parseProductosCsv("codigo_interno,nombre\nX,Y")).toThrow(
      /precio.*stock|stock.*precio/,
    );
  });

  test("CSV sin filas de datos → ValidationError", () => {
    expect(() => parseProductosCsv(HEADER)).toThrow(ValidationError);
    expect(() => parseProductosCsv("")).toThrow(ValidationError);
  });
});
