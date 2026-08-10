import { describe, expect, test } from "vitest";
import {
  evaluarEscalado,
  normalizarPalabrasEscalado,
  normalizarTexto,
  palabraQueEscala,
  textoDelCliente,
} from "@/lib/agente/escalado";

describe("normalizarTexto", () => {
  test("baja a minusculas y saca tildes", () => {
    expect(normalizarTexto("Devolución")).toBe("devolucion");
  });

  test("colapsa espacios y recorta", () => {
    expect(normalizarTexto("  factura   A  ")).toBe("factura a");
  });

  test("la enie tambien se descompone: 'mañana' y 'manana' colapsan igual", () => {
    // Efecto de sacar TODO el rango de diacriticos combinantes. Es lo que
    // queremos para comparar: quien escribe "manana" sin enie coincide igual.
    expect(normalizarTexto("MAÑANA")).toBe(normalizarTexto("manana"));
  });
});

describe("normalizarPalabrasEscalado", () => {
  test("deduplica dos escrituras de la misma palabra", () => {
    expect(normalizarPalabrasEscalado(["Devolución", "devolucion"])).toEqual(["devolucion"]);
  });

  test("conserva el orden de la primera aparicion", () => {
    expect(normalizarPalabrasEscalado(["abogado", "reclamo", "ABOGADO"])).toEqual([
      "abogado",
      "reclamo",
    ]);
  });

  test("descarta vacias y solo-espacios", () => {
    expect(normalizarPalabrasEscalado(["", "   ", "roto"])).toEqual(["roto"]);
  });
});

describe("palabraQueEscala", () => {
  test("coincide por palabra completa, no por subcadena", () => {
    expect(palabraQueEscala("doble a la izquierda en la rotonda", ["roto"])).toBeNull();
    expect(palabraQueEscala("el paragolpes vino roto", ["roto"])).toBe("roto");
  });

  test("el texto entrante con tildes coincide con la lista ya normalizada", () => {
    expect(palabraQueEscala("quiero la devolución", ["devolucion"])).toBe("devolucion");
  });

  test("una frase de varias palabras coincide entera", () => {
    expect(palabraQueEscala("necesito factura a por favor", ["factura a"])).toBe("factura a");
    expect(palabraQueEscala("necesito factura b", ["factura a"])).toBeNull();
  });

  test("los metacaracteres de la palabra son literales", () => {
    // Sin escapar, "c." haria match con cualquier "c" + un caracter.
    expect(palabraQueEscala("cambio de cubierta", ["c."])).toBeNull();
    expect(palabraQueEscala("el modelo c. no anda", ["c."])).toBe("c.");
  });

  test("devuelve la primera de la lista que aparece, no la primera del texto", () => {
    expect(palabraQueEscala("un reclamo con abogado", ["abogado", "reclamo"])).toBe("abogado");
  });

  test("texto null o lista vacia no coinciden", () => {
    expect(palabraQueEscala(null, ["abogado"])).toBeNull();
    expect(palabraQueEscala("abogado", [])).toBeNull();
  });
});

describe("textoDelCliente", () => {
  test("devuelve el contenido del ultimo mensaje del lead", () => {
    expect(textoDelCliente(["ia: hola", "lead: quiero un abogado"])).toBe("quiero un abogado");
  });

  test("si el ultimo lo escribio la IA o un humano, no hay texto entrante", () => {
    expect(textoDelCliente(["lead: hola", "ia: te paso el precio"])).toBeNull();
    expect(textoDelCliente(["lead: hola", "humano: ya te contesto"])).toBeNull();
  });

  test("turno vacio no rompe", () => {
    expect(textoDelCliente([])).toBeNull();
  });

  test("el resumen previo no se confunde con un mensaje del cliente", () => {
    expect(textoDelCliente(["[Resumen previo]: el cliente pidio un abogado"])).toBeNull();
  });
});

describe("evaluarEscalado", () => {
  const base = {
    palabras: [] as string[],
    cotizacionDesde: null as number | null,
    precioCotizado: null as number | null,
    textoEntrante: null as string | null,
  };

  test("config de fabrica (todo apagado) no escala nunca", () => {
    expect(evaluarEscalado({ ...base, textoEntrante: "quiero hablar con un abogado" })).toBeNull();
  });

  test("una palabra de la lista escala y el motivo la nombra", () => {
    const r = evaluarEscalado({
      ...base,
      palabras: ["abogado"],
      textoEntrante: "voy a llamar a mi abogado",
    });
    expect(r?.condicion).toBe("palabra");
    expect(r?.motivo).toContain("abogado");
  });

  test("cotizacion en o por encima del tope escala", () => {
    expect(
      evaluarEscalado({ ...base, cotizacionDesde: 500_000, precioCotizado: 500_000 })?.condicion,
    ).toBe("cotizacion");
    expect(
      evaluarEscalado({ ...base, cotizacionDesde: 500_000, precioCotizado: 499_999 }),
    ).toBeNull();
  });

  test("cotizacion apagada (null) no escala por mas alto que sea el monto", () => {
    expect(
      evaluarEscalado({ ...base, cotizacionDesde: null, precioCotizado: 9_000_000 }),
    ).toBeNull();
  });

  test("sesion sin cotizacion todavia no dispara la condicion de monto", () => {
    expect(evaluarEscalado({ ...base, cotizacionDesde: 100_000, precioCotizado: null })).toBeNull();
  });

  test("con las dos cumplidas gana la palabra: es la condicion 'siempre'", () => {
    const r = evaluarEscalado({
      palabras: ["reclamo"],
      textoEntrante: "hago un reclamo",
      cotizacionDesde: 100_000,
      precioCotizado: 900_000,
    });
    expect(r?.condicion).toBe("palabra");
  });
});
