import { describe, expect, test } from "vitest";
import { preguntaClave } from "@/lib/catalogo/pregunta-clave";

/*
 * La pregunta que el agente tiene que hacer NO se programa por tipo de pieza:
 * se calcula. Es el eje que varía entre los candidatos que devolvió la
 * búsqueda. Si el agente no la hace, vende la pieza equivocada; si pregunta
 * cuando ya no hay ambigüedad, pierde al cliente por pesado.
 *
 * Las descripciones de estos tests son filas reales del catálogo.
 */
const desc = (nombre: string, descripcion: string | null = null) => ({ nombre, descripcion });

describe("preguntaClave", () => {
  test("con un solo candidato no pregunta nada", () => {
    expect(preguntaClave([desc("CH AVEO 1.6 /0 16V NUBIRA 1.6")])).toBeNull();
  });

  test("sin candidatos no pregunta nada", () => {
    expect(preguntaClave([])).toBeNull();
  });

  test("candidatos que difieren en cilindrada preguntan la cilindrada", () => {
    const r = preguntaClave([desc("CH AVEO 1.4 /0 16V"), desc("CH AVEO 1.6 /0 16V NUBIRA 1.6")]);
    expect(r?.eje).toBe("cilindrada");
    expect(r?.valores).toEqual(["1.4", "1.6"]);
    expect(r?.esPregunta).toBe(true);
  });

  test("identificar el auto va antes que la medida", () => {
    // Los cuatro son pistones de Aveo: dos cilindradas y dos sobremedidas.
    // Preguntar la medida primero obligaría a repreguntar la cilindrada después.
    const r = preguntaClave([
      desc("CH AVEO 1.4 /0 16V"),
      desc("CH AVEO 1.4 /2 16V"),
      desc("CH AVEO 1.6 /0 16V NUBIRA 1.6"),
      desc("CH AVEO 1.6 /2 16V NUBIRA 1.6"),
    ]);
    expect(r?.eje).toBe("cilindrada");
  });

  test("resuelta la cilindrada, la pregunta pasa a ser la medida", () => {
    const r = preguntaClave([
      desc("CH AVEO 1.6 /0 16V NUBIRA 1.6"),
      desc("CH AVEO 1.6 /2 16V NUBIRA 1.6"),
      desc("CH AVEO 1.6 /3 16V NUBIRA 1.6"),
    ]);
    expect(r?.eje).toBe("medida");
    expect(r?.valores).toEqual(["STD", "0.50", "0.75"]);
  });

  test("la medida se lee aunque venga pegada al año", () => {
    // `05-13/0` y `05-13/3` son la escritura real del catálogo.
    const r = preguntaClave([desc("CH DMAX 2.4 05-13/0 S/R"), desc("CH DMAX 2.4 05-13/3")]);
    expect(r?.eje).toBe("medida");
  });

  test("el lado se pregunta antes que la medida", () => {
    // Vender el lado equivocado es devolución segura.
    const r = preguntaClave([
      desc("HY STA FE 2.2 DLS STA FE 2.7 06- POST LH"),
      desc("HY STA FE 2.2 DLS STA FE 2.7 06- POST RH"),
    ]);
    expect(r?.eje).toBe("lado");
    expect(r?.valores).toEqual(["LH", "RH"]);
  });

  test("cuando solo cambia el fabricante no es pregunta: es oferta de precio", () => {
    // El cliente no sabe ni le importa quién la fabricó. Acá el agente ofrece
    // gama —genuino contra alternativo— y sube el ticket en vez de interrogar.
    const r = preguntaClave([
      desc("HY TUCS 05- SPORTG ELANT 09- SOUL 08-", "MOBIS"),
      desc("HY TUCS 05- SPORTG ELANT 09- SOUL 08-", "CHINA"),
    ]);
    expect(r?.eje).toBe("fabricante");
    expect(r?.esPregunta).toBe(false);
  });

  test("candidatos equivalentes en todo no generan pregunta", () => {
    const r = preguntaClave([
      desc("CH LUV DMAX 2.4 15- RT-53/0", "MOBIS"),
      desc("CH LUV DMAX 2.4 15- RT-53/0", "MOBIS"),
    ]);
    expect(r).toBeNull();
  });

  test("el año discrimina cuando la cilindrada no alcanza", () => {
    const r = preguntaClave([desc("CH AVEO 1.6 05-"), desc("CH AVEO 1.6 12-")]);
    expect(r?.eje).toBe("anio");
  });
});
