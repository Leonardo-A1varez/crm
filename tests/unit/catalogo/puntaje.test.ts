import { describe, expect, test } from "vitest";
import { type ProductoPuntuable, puntaje } from "@/lib/catalogo/puntaje";

/*
 * Este módulo es el ESPEJO TypeScript de `public.buscar_productos`. Los dos
 * tienen que dar el mismo orden: uno corre en Postgres contra el catálogo real
 * y el otro en memoria, en los tests y en el repo in-memory. Si divergen, la
 * suite pasa en verde y el agente vende otra cosa.
 *
 * Los pesos por palabra ya existían en `catalog-matcher.service.ts`; lo nuevo
 * acá es la prioridad entre los tres códigos.
 */
const prod = (p: Partial<ProductoPuntuable> = {}): ProductoPuntuable => ({
  codigo_interno: "14436",
  codigo_fabrica: "96389106/STD/K",
  otros_codigos: [],
  nombre: "CH AVEO 1.6 /0 16V NUBIRA 1.6",
  categoria: "PISTONES",
  descripcion: "TEIKIN 79mm_1.2*1.5*3",
  ...p,
});

describe("puntaje — códigos", () => {
  test("el número de fábrica dictado tal cual da el puntaje máximo", () => {
    expect(puntaje(prod(), "96389106")).toBe(1000);
  });

  test("el mismo número con sufijos de medida y origen da lo mismo", () => {
    // El taller dicta lo grabado en la pieza; la casa le agrega `/STD/K`.
    expect(puntaje(prod(), "96389106/STD/K")).toBe(1000);
  });

  test("el mismo número escrito con separadores distintos da lo mismo", () => {
    expect(puntaje(prod(), "9638-9106")).toBe(1000);
  });

  test("el código de fábrica gana al interno", () => {
    // Los dos identifican la fila, pero el de fábrica es el que el cliente
    // tiene en la mano: si una consulta machea los dos, manda ese.
    const p = prod({ codigo_interno: "555", codigo_fabrica: "96389106" });
    expect(puntaje(p, "96389106")).toBe(1000);
    // 900 por el código interno + 20 porque la palabra "555" además acierta
    // contra la columna `codigo_interno` y acierta TODAS las palabras, que
    // duplica. Verificado contra `buscar_productos` corriendo en Postgres: la
    // consulta `14436` devuelve 920. El espejo copia eso, no lo redondea.
    expect(puntaje(p, "555")).toBe(920);
  });

  test("un código alterno machea, pero vale menos", () => {
    // Medido: 343 filas tienen el número de fábrica SOLO en esta columna.
    const p = prod({ codigo_fabrica: "30405/0.75", otros_codigos: ["96389106"] });
    expect(puntaje(p, "96389106")).toBe(700);
  });

  test("un código que no es de nadie no puntúa por código", () => {
    expect(puntaje(prod(), "00000000")).toBe(0);
  });
});

describe("puntaje — texto", () => {
  test("acertar todas las palabras vale el doble que acertar una", () => {
    // Entre el pistón del Aveo y el del Spark, el que cumple las dos palabras
    // tiene que quedar claramente arriba.
    const unaSola = puntaje(prod({ nombre: "CH SPARK 1.0" }), "piston aveo");
    const lasDos = puntaje(prod(), "piston aveo");
    expect(lasDos).toBeGreaterThan(unaSola);
  });

  test("la categoría exacta pesa más que contenerla", () => {
    // Quien pide "radiador" quiere un RADIADOR, no una MANG RADIADOR.
    const exacta = puntaje(prod({ categoria: "RADIADOR", nombre: "CH AVEO" }), "radiador");
    const contiene = puntaje(prod({ categoria: "MANG RADIADOR", nombre: "CH AVEO" }), "radiador");
    expect(exacta).toBeGreaterThan(contiene);
  });

  test("las palabras de relleno no puntúan", () => {
    // Sin esto, "el" puntuaría contra medio catálogo.
    expect(puntaje(prod({ nombre: "EL", categoria: null, descripcion: null }), "el")).toBe(0);
  });

  test("un producto que no tiene nada que ver da cero", () => {
    expect(puntaje(prod(), "amortiguador tucson")).toBe(0);
  });
});
