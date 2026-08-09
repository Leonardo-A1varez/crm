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
    expect(excedeDescuento("puedo hacerte 8% de descuento, o hasta 20% si llevas dos", 10)).toBe(
      20,
    );
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

describe("no dispara con lenguaje comercial que no es descuento", () => {
  test("garantias expresadas en porcentaje", () => {
    expect(excedeDescuento("te lo garantizo 100%", 10)).toBeNull();
    expect(
      excedeDescuento("Satisfaccion 100% garantizada o te devolvemos el dinero", 10),
    ).toBeNull();
  });

  test("especificaciones de producto", () => {
    expect(excedeDescuento("tiene 30% mas de duracion que el original", 10)).toBeNull();
    expect(excedeDescuento("bateria cargada al 80%", 10)).toBeNull();
  });

  test("impuestos y recargos, tambien en plural", () => {
    expect(
      excedeDescuento("El importe final contempla todos los impuestos vigentes del 21%", 10),
    ).toBeNull();
    expect(excedeDescuento("Los recargos por mora pueden llegar al 15%", 10)).toBeNull();
    expect(excedeDescuento("Todos los impuestos y tasas suman 21%", 10)).toBeNull();
  });

  test("financiacion", () => {
    expect(excedeDescuento("12 cuotas sin interes", 10)).toBeNull();
    expect(excedeDescuento("financiamos con 15% de interes", 10)).toBeNull();
  });
});

describe("si dispara con descuentos reales", () => {
  test("con la palabra descuento", () => {
    expect(excedeDescuento("Te hago un 15% de descuento.", 10)).toBe(15);
    expect(excedeDescuento("un 20% de rebaja en el kit completo", 10)).toBe(20);
  });

  test("con verbo de ofrecimiento y sin la palabra descuento", () => {
    expect(excedeDescuento("te dejo un 15% si te lo llevas hoy", 10)).toBe(15);
    expect(excedeDescuento("te hago un 12,5%", 10)).toBe(12.5);
  });

  test("con off", () => {
    expect(excedeDescuento("Te dejo un 5% off.", 0)).toBe(5);
  });
});
