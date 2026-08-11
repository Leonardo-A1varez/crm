import { describe, expect, test } from "vitest";
import {
  buscarCoincidencias,
  contarCoincidencias,
  indexarHilo,
  partirTexto,
  plegar,
  recorteConCoincidencia,
} from "@/lib/ui/busqueda-hilo";

describe("plegar", () => {
  test("baja a minúsculas y saca los diacríticos, la ñ incluida", () => {
    // La ñ se pliega a n como cualquier otro diacrítico: buscar "cigüeñal"
    // sin acentos ni ñ, que es como se escribe apurado, tiene que encontrarlo.
    expect(plegar("Cigüeñal ÁÉÍÓÚ")).toBe("ciguenal aeiou");
  });

  test("la aguja sin ñ encuentra la palabra con ñ", () => {
    expect(buscarCoincidencias("cigueñal roto", "cigüenal")).toEqual([{ inicio: 0, fin: 8 }]);
  });

  test("conserva la longitud en unidades UTF-16", () => {
    // Es la propiedad de la que dependen los índices: si el plegado midiera
    // distinto, el resaltado cortaría el texto original en el lugar equivocado.
    for (const texto of ["árbol", "İstanbul", "motor 🔧 v8", "ñandú", "straße"]) {
      expect(plegar(texto)).toHaveLength(texto.length);
    }
  });
});

describe("buscarCoincidencias", () => {
  test("encuentra todas y devuelve rangos sobre el texto original", () => {
    const texto = "Bujía y bujía";
    const rangos = buscarCoincidencias(texto, "BUJIA");
    expect(rangos).toEqual([
      { inicio: 0, fin: 5 },
      { inicio: 8, fin: 13 },
    ]);
    expect(texto.slice(0, 5)).toBe("Bujía");
    expect(texto.slice(8, 13)).toBe("bujía");
  });

  test("no se solapa consigo misma", () => {
    expect(buscarCoincidencias("aaaa", "aa")).toEqual([
      { inicio: 0, fin: 2 },
      { inicio: 2, fin: 4 },
    ]);
  });

  test("consulta vacía o de puros espacios no coincide con nada", () => {
    expect(buscarCoincidencias("lo que sea", "")).toEqual([]);
    expect(buscarCoincidencias("lo que sea", "   ")).toEqual([]);
    expect(contarCoincidencias("lo que sea", "")).toBe(0);
  });

  test("un emoji antes de la aguja no corre el índice", () => {
    const texto = "🔧 filtro";
    const [rango] = buscarCoincidencias(texto, "filtro");
    expect(rango).toBeDefined();
    expect(texto.slice(rango!.inicio, rango!.fin)).toBe("filtro");
  });
});

describe("partirTexto", () => {
  test("alterna texto suelto y coincidencias numeradas desde el ordinal inicial", () => {
    expect(partirTexto("hay bujía nueva", "bujia", 7)).toEqual([
      { texto: "hay ", ordinal: null },
      { texto: "bujía", ordinal: 7 },
      { texto: " nueva", ordinal: null },
    ]);
  });

  test("sin coincidencias devuelve el texto entero en un solo tramo", () => {
    expect(partirTexto("hola", "bujia", 0)).toEqual([{ texto: "hola", ordinal: null }]);
  });

  test("los tramos reconstruyen el texto original", () => {
    const texto = "Bujía NGK, bujía Bosch y bujías sueltas";
    const unidos = partirTexto(texto, "bujía", 0)
      .map((t) => t.texto)
      .join("");
    expect(unidos).toBe(texto);
  });

  test("numera correlativo desde el ordinal inicial", () => {
    const ordinales = partirTexto("aa", "a", 3)
      .map((t) => t.ordinal)
      .filter((o) => o !== null);
    expect(ordinales).toEqual([3, 4]);
  });
});

describe("indexarHilo", () => {
  test("acumula el corrimiento mensaje a mensaje", () => {
    expect(indexarHilo(["bujía y bujía", "nada", "bujía"], "bujia")).toEqual({
      ordinalInicial: [0, 2, 2],
      total: 3,
    });
  });

  test("un texto vacío no aporta ordinales", () => {
    // Es cómo entra el separador de sistema: se dibuja sin `<mark>`, así que
    // contarlo dejaría ordinales sin ancla en el DOM.
    expect(indexarHilo(["", "bujía"], "bujia")).toEqual({ ordinalInicial: [0, 0], total: 1 });
  });

  test("hilo vacío o consulta vacía dan total cero", () => {
    expect(indexarHilo([], "bujia")).toEqual({ ordinalInicial: [], total: 0 });
    expect(indexarHilo(["bujía"], "")).toEqual({ ordinalInicial: [0], total: 0 });
  });

  test("el ordinal inicial de cada mensaje es el que numera bien sus tramos", () => {
    const textos = ["bujía y bujía", "otra bujía"];
    const { ordinalInicial } = indexarHilo(textos, "bujía");
    const ordinales = textos.flatMap((texto, i) =>
      partirTexto(texto, "bujía", ordinalInicial[i] ?? 0)
        .map((t) => t.ordinal)
        .filter((o) => o !== null),
    );
    expect(ordinales).toEqual([0, 1, 2]);
  });
});

describe("recorteConCoincidencia", () => {
  test("un texto corto vuelve entero y sin marcas de recorte", () => {
    expect(recorteConCoincidencia("pastillas de freno", "freno")).toEqual({
      texto: "pastillas de freno",
      recortadoInicio: false,
      recortadoFin: false,
    });
  });

  test("con la coincidencia al final, el recorte la contiene igual", () => {
    const largo = `${"x".repeat(400)} bujía NGK`;
    const r = recorteConCoincidencia(largo, "bujía");
    expect(r.texto).toContain("bujía");
    expect(r.recortadoInicio).toBe(true);
    expect(r.recortadoFin).toBe(false);
    // El recorte tiene que seguir siendo cortable por `partirTexto`: es lo que
    // le da el resaltado al cliente.
    expect(partirTexto(r.texto, "bujía", 0).some((t) => t.ordinal !== null)).toBe(true);
  });

  test("con la coincidencia al principio no se corre hacia atrás", () => {
    const r = recorteConCoincidencia(`freno ${"y".repeat(400)}`, "freno");
    expect(r.recortadoInicio).toBe(false);
    expect(r.recortadoFin).toBe(true);
    expect(r.texto.startsWith("freno")).toBe(true);
  });

  test("sin coincidencia devuelve el principio del texto", () => {
    const r = recorteConCoincidencia(`${"a".repeat(400)}`, "zzz");
    expect(r.recortadoInicio).toBe(false);
    expect(r.recortadoFin).toBe(true);
    expect(r.texto.length).toBeLessThan(400);
  });

  test("el recorte nunca es más largo que el texto original", () => {
    const r = recorteConCoincidencia("corto", "corto");
    expect(r.texto).toBe("corto");
  });
});
