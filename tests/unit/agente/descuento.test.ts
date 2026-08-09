import { describe, expect, test } from "vitest";
import { excedeDescuento } from "@/lib/agente/descuento";

describe("excedeDescuento", () => {
  test("detecta un porcentaje por encima del maximo", () => {
    expect(excedeDescuento("Te hago un 15% de descuento.", 10)).toBe(15);
  });

  test("no dispara si esta dentro del maximo", () => {
    expect(excedeDescuento("Te hago un 8% de descuento.", 10)).toBeNull();
  });

  test("el borde exacto no excede", () => {
    expect(excedeDescuento("Te hago un 10% de descuento.", 10)).toBeNull();
  });

  test("con maximo 0 cualquier descuento excede", () => {
    expect(excedeDescuento("Te dejo un 5% off.", 0)).toBe(5);
  });

  test("reconoce decimales con coma y con punto", () => {
    expect(excedeDescuento("un 12,5% de descuento", 10)).toBe(12.5);
    expect(excedeDescuento("un 12.5% de descuento", 10)).toBe(12.5);
  });

  test("reconoce el porcentaje con espacio antes del simbolo", () => {
    expect(excedeDescuento("un 15 % de descuento", 10)).toBe(15);
  });

  test("devuelve el mayor si hay varios porcentajes", () => {
    expect(excedeDescuento("puedo 8% o hasta 20% si llevas dos", 10)).toBe(20);
  });

  test("ignora porcentajes que no son descuento", () => {
    // El IVA es 21% y se nombra todo el tiempo: confundirlo con un descuento
    // pausaria conversaciones sanas.
    expect(excedeDescuento("El precio ya incluye el 21% de IVA.", 10)).toBeNull();
  });

  test("texto sin porcentajes no excede", () => {
    expect(excedeDescuento("Tenemos el repuesto en stock.", 0)).toBeNull();
  });

  test("texto vacio no excede", () => {
    expect(excedeDescuento("", 0)).toBeNull();
  });
});
