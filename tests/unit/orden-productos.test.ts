import { describe, expect, test } from "vitest";
import type { NivelOrden } from "@/lib/catalogo/columnas-productos";
import { leerOrden } from "@/lib/ui/filtros-productos";
import {
  alternarOrden,
  escribirOrden,
  ordenarColumna,
  ordenDeColumna,
  quitarNivel,
  quitarOrdenDeColumna,
  quitarTodoElOrden,
  rotulosDeOrden,
} from "@/lib/ui/orden-productos";

/** Atajo: "marca:asc" → { campo: "marca", dir: "asc" }. */
const n = (s: string): NivelOrden => {
  const [campo, dir] = s.split(":");
  return { campo, dir } as NivelOrden;
};
const niveles = (...s: string[]) => s.map(n);

describe("alternarOrden: las reglas del clic en 'Ordenar'", () => {
  // [descripción, niveles elegidos, clic, niveles que quedan]
  test.each<[string, string[], string, string[]]>([
    ["sin orden elegido, el primer clic empieza el orden", [], "marca:asc", ["marca:asc"]],
    [
      "una columna nueva se agrega como el siguiente nivel",
      ["marca:asc"],
      "precio:desc",
      ["marca:asc", "precio:desc"],
    ],
    [
      "y como tercero",
      ["marca:asc", "precio:desc"],
      "stock:asc",
      ["marca:asc", "precio:desc", "stock:asc"],
    ],
    [
      "el sentido opuesto invierte la columna sin moverla de nivel (nivel 1)",
      ["marca:asc", "precio:desc"],
      "marca:desc",
      ["marca:desc", "precio:desc"],
    ],
    [
      "el sentido opuesto invierte la columna sin moverla de nivel (nivel 2)",
      ["marca:asc", "precio:desc", "stock:asc"],
      "precio:asc",
      ["marca:asc", "precio:asc", "stock:asc"],
    ],
    [
      "el mismo sentido saca la columna: el botón activo es un interruptor",
      ["marca:asc", "precio:desc"],
      "precio:desc",
      ["marca:asc"],
    ],
    [
      "sacar el nivel 1 asciende a los demás",
      ["marca:asc", "precio:desc", "stock:asc"],
      "marca:asc",
      ["precio:desc", "stock:asc"],
    ],
    ["sacar la única columna vuelve al orden por defecto", ["marca:asc"], "marca:asc", []],
    [
      "una cuarta columna distinta reinicia el orden y queda como nivel 1",
      ["marca:asc", "precio:desc", "stock:asc"],
      "estado:asc",
      ["estado:asc"],
    ],
    [
      "con tres niveles, tocar una de ellas NO reinicia",
      ["marca:asc", "precio:desc", "stock:asc"],
      "stock:desc",
      ["marca:asc", "precio:desc", "stock:desc"],
    ],
  ])("%s", (_nombre, antes, clic, despues) => {
    const [campo, dir] = clic.split(":");
    expect(alternarOrden(niveles(...antes), campo as never, dir as never)).toEqual(
      niveles(...despues),
    );
  });

  test("no modifica los niveles que recibe", () => {
    const antes = niveles("marca:asc");
    alternarOrden(antes, "precio", "asc");
    expect(antes).toEqual(niveles("marca:asc"));
  });

  test("tocar tres veces la misma columna la agrega, la invierte y la saca", () => {
    let o: NivelOrden[] = [];
    o = alternarOrden(o, "marca", "asc");
    expect(o).toEqual(niveles("marca:asc"));
    o = alternarOrden(o, "marca", "desc");
    expect(o).toEqual(niveles("marca:desc"));
    o = alternarOrden(o, "marca", "desc");
    expect(o).toEqual([]);
  });
});

describe("quitarNivel", () => {
  test("saca solo esa columna y los demás conservan su orden relativo", () => {
    expect(quitarNivel(niveles("a:asc", "b:asc"), "marca")).toEqual(niveles("a:asc", "b:asc"));
    expect(quitarNivel(niveles("marca:asc", "precio:desc", "stock:asc"), "precio")).toEqual(
      niveles("marca:asc", "stock:asc"),
    );
  });
});

describe("las funciones de URL", () => {
  test("ordenarColumna escribe orden/dir repetidos, el principal primero, y conserva los filtros", () => {
    const p1 = ordenarColumna("estado=activo", "marca", "asc");
    expect(p1.toString()).toBe("estado=activo&orden=marca&dir=asc");
    const p2 = ordenarColumna(p1, "precio", "desc");
    expect(p2.getAll("orden")).toEqual(["marca", "precio"]);
    expect(p2.getAll("dir")).toEqual(["asc", "desc"]);
    expect(p2.get("estado")).toBe("activo");
    expect(leerOrden(p2)).toEqual(niveles("marca:asc", "precio:desc"));
  });

  test("ordenarColumna: el mismo sentido saca la columna de la URL", () => {
    const p = ordenarColumna("orden=marca&dir=asc&orden=precio&dir=desc", "marca", "asc");
    expect(leerOrden(p)).toEqual(niveles("precio:desc"));
    const sinNada = ordenarColumna("orden=marca&dir=asc", "marca", "asc");
    expect(sinNada.toString()).toBe("");
  });

  test("ordenarColumna: una cuarta columna reinicia", () => {
    const p = ordenarColumna(
      "orden=codigo&dir=asc&orden=marca&dir=asc&orden=precio&dir=asc",
      "stock",
      "desc",
    );
    expect(leerOrden(p)).toEqual(niveles("stock:desc"));
  });

  test("lo escrito a mano en la URL que no es un campo se ignora antes de aplicar la regla", () => {
    const p = ordenarColumna("orden=nombre&dir=asc", "marca", "asc");
    expect(leerOrden(p)).toEqual(niveles("marca:asc"));
  });

  test("quitarOrdenDeColumna y quitarTodoElOrden", () => {
    const base = "q=x&orden=marca&dir=asc&orden=precio&dir=desc";
    expect(leerOrden(quitarOrdenDeColumna(base, "marca"))).toEqual(niveles("precio:desc"));
    expect(quitarOrdenDeColumna(base, "stock").getAll("orden")).toEqual(["marca", "precio"]);
    const sin = quitarTodoElOrden(base);
    expect(sin.toString()).toBe("q=x");
  });

  test("escribirOrden no escribe más de tres niveles", () => {
    const p = escribirOrden("", niveles("codigo:asc", "marca:asc", "precio:asc", "stock:asc"));
    expect(p.getAll("orden")).toEqual(["codigo", "marca", "precio"]);
  });
});

describe("ordenDeColumna: el encabezado y el panel", () => {
  test("sin orden elegido ninguna columna figura como ordenada", () => {
    expect(ordenDeColumna([], "descripcion")).toEqual({ nivel: null, dir: null, niveles: 0 });
  });

  test("con niveles dice cuál es el de la columna y cuántos hay", () => {
    const o = niveles("marca:asc", "precio:desc");
    expect(ordenDeColumna(o, "precio")).toEqual({ nivel: 2, dir: "desc", niveles: 2 });
    expect(ordenDeColumna(o, "marca")).toEqual({ nivel: 1, dir: "asc", niveles: 2 });
    expect(ordenDeColumna(o, "stock")).toEqual({ nivel: null, dir: null, niveles: 2 });
  });
});

describe("rotulosDeOrden", () => {
  test("letras, números y estado se leen distinto", () => {
    expect(rotulosDeOrden("marca")).toEqual({ asc: "A → Z", desc: "Z → A" });
    expect(rotulosDeOrden("precio")).toEqual({ asc: "Menor a mayor", desc: "Mayor a menor" });
    expect(rotulosDeOrden("codigo").asc).toBe("Menor a mayor");
    expect(rotulosDeOrden("estado").asc).toBe("Activos primero");
  });
});
