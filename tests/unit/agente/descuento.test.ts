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

describe("el veto gana cuando hay senal de descuento y palabra vetada", () => {
  test("IVA vetado aunque haya verbo de ofrecimiento cerca", () => {
    // Sin este test, invertir el orden de las dos comprobaciones o borrar el
    // veto pasaria desapercibido: los demas casos null llegan por ausencia de
    // senal, no por veto.
    expect(excedeDescuento("hacemos el 21% de IVA discriminado en la factura", 10)).toBeNull();
  });

  test("recargo vetado aunque se ofrezca", () => {
    expect(excedeDescuento("te aplicamos un 15% de recargo por tarjeta", 10)).toBeNull();
  });
});

describe("dispara con frases de recorte de precio sin la palabra descuento", () => {
  test("clitico entre pronombre y verbo", () => {
    expect(excedeDescuento("Te lo dejo en 15% menos del precio de lista.", 10)).toBe(15);
  });

  test("verbos de bajar precio", () => {
    expect(excedeDescuento("Te bajo el precio un 15%.", 10)).toBe(15);
    expect(excedeDescuento("Con este cupon el precio baja un 20%.", 10)).toBe(20);
  });
});

describe("no dispara con menos o mas sin contexto de precio", () => {
  test("especificacion de producto con menos", () => {
    // Sin el ancla de precio esto volveria a ser un falso positivo.
    expect(excedeDescuento("el filtro nuevo tiene 30% menos de restriccion", 10)).toBeNull();
    expect(excedeDescuento("pesa 20% menos que el original", 10)).toBeNull();
  });
});

describe("limitacion conocida: parafrasis de descuento sin senal inequivoca", () => {
  // Se aceptan estos falsos negativos a proposito. Cubrirlos exigia senales
  // ambiguas (`baja`, `menos`, `queda`) que disparaban con especificaciones de
  // producto — "la bateria baja 20%", "queda 15% menos de stock"— y bloquear
  // una respuesta sana cuesta un cliente, mientras que no detectar una
  // parafrasis cuesta margen. El control real del margen no es este modulo.
  test("verbo de bajar sin la palabra precio", () => {
    expect(excedeDescuento("Podemos bajarlo un 15%.", 10)).toBeNull();
  });

  test("restar", () => {
    expect(excedeDescuento("Restamos un 15% por pago anticipado.", 10)).toBeNull();
  });

  test("mas barato", () => {
    expect(excedeDescuento("Si pagas en efectivo te queda 20% mas barato.", 10)).toBeNull();
  });
});

describe("no dispara con especificaciones tecnicas que usan bajar o menos", () => {
  test("bajar sin la palabra precio", () => {
    expect(excedeDescuento("la bateria baja 20% en invierno", 10)).toBeNull();
    expect(
      excedeDescuento("el consumo de combustible baja 20% respecto al modelo anterior", 10),
    ).toBeNull();
    expect(excedeDescuento("el rendimiento baja 20% con el uso", 10)).toBeNull();
  });

  test("menos con palabras de precio alrededor", () => {
    expect(excedeDescuento("el filtro cuesta lo mismo y pesa 20% menos", 10)).toBeNull();
    expect(excedeDescuento("queda 15% menos de stock", 10)).toBeNull();
    expect(
      excedeDescuento("queda 15% menos de stock, aunque el precio de lista no cambia", 10),
    ).toBeNull();
    expect(
      excedeDescuento("El precio de lista es $50000 y el modelo nuevo pesa 20% menos.", 10),
    ).toBeNull();
  });
});

describe("no dispara con ofrecimientos que no son de descuento", () => {
  test("ofrecer un producto o un dato cerca de un porcentaje de especificacion", () => {
    // "te doy"/"te dejo" seguido de algo que no es el porcentaje: el numero es
    // una especificacion, no lo que se ofrece.
    expect(excedeDescuento("te doy el filtro que rinde 20% mas", 10)).toBeNull();
    expect(
      excedeDescuento("te doy un dato: el rendimiento sube 20% con este aceite", 10),
    ).toBeNull();
    expect(
      excedeDescuento("te lo dejo anotado: el filtro rinde 20% mas que el original", 10),
    ).toBeNull();
  });
});

describe("no dispara con precios en pasado", () => {
  test("historia de precios no es una oferta vigente", () => {
    expect(
      excedeDescuento(
        "Los precios bajaron 20% el año pasado por la inflacion, ahora estan estables.",
        10,
      ),
    ).toBeNull();
  });
});

describe("no dispara cuando el porcentaje describe una prestacion", () => {
  test("mas de un atributo del producto", () => {
    // "te doy 20% mas de potencia" es un argumento de venta, no una oferta.
    expect(excedeDescuento("te doy 20% mas de potencia con este filtro de aire", 10)).toBeNull();
    expect(excedeDescuento("te dejo un 15% mas de autonomia con esta bateria", 10)).toBeNull();
    expect(
      excedeDescuento("te doy un 30% mas de vida util en las pastillas de freno", 10),
    ).toBeNull();
    expect(excedeDescuento("te doy 25% mas de torque con este chip", 10)).toBeNull();
  });

  test("menos de un atributo del producto", () => {
    expect(excedeDescuento("te hago 20% menos de consumo con este inyector", 10)).toBeNull();
    expect(
      excedeDescuento("te dejo 20% menos de vibracion con este soporte de motor", 10),
    ).toBeNull();
  });

  test("pero menos del precio si es una oferta", () => {
    expect(excedeDescuento("Te lo dejo en 15% menos del precio de lista.", 10)).toBe(15);
  });
});

describe("no dispara con movimientos hipoteticos del precio", () => {
  test("condicional y temporal", () => {
    expect(excedeDescuento("si el precio baja 20% te aviso enseguida", 10)).toBeNull();
    expect(
      excedeDescuento("cuando el precio baja 20%, es por promocion de fabrica", 10),
    ).toBeNull();
  });
});
