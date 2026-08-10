import { describe, expect, test } from "vitest";
import { normalizarEtiqueta, opcionesSelector } from "@/lib/ui/selector-etiquetas";
import type { Tag } from "@/types/entities";

function tag(nombre: string, id = nombre): Tag {
  return { id, nombre, color: "#888888", descripcion: null };
}

describe("normalizarEtiqueta", () => {
  test("ignora mayúsculas, bordes y tildes", () => {
    expect(normalizarEtiqueta("  Flota Municipál ")).toBe("flota municipal");
  });
});

describe("opcionesSelector", () => {
  test("con la lista vacía solo queda crear lo que se escriba", () => {
    expect(opcionesSelector([], [], "")).toEqual({ candidatas: [], puedeCrear: false });
    expect(opcionesSelector([], [], "flota")).toMatchObject({
      candidatas: [],
      puedeCrear: true,
    });
  });

  test("sin consulta ofrece todo el catálogo que el lead no tiene", () => {
    const puesta = tag("mayorista");
    const libre = tag("flota");

    const { candidatas, puedeCrear } = opcionesSelector([puesta, libre], [puesta], "");

    expect(candidatas.map((t) => t.nombre)).toEqual(["flota"]);
    expect(puedeCrear).toBe(false);
  });

  test("filtra por substring sin importar tildes ni mayúsculas", () => {
    const { candidatas } = opcionesSelector([tag("Flota Municipál"), tag("mayorista")], [], "muni");

    expect(candidatas.map((t) => t.nombre)).toEqual(["Flota Municipál"]);
  });

  test("no ofrece crear un nombre que ya existe, aunque el lead no lo tenga", () => {
    const existente = tag("mayorista");

    const { candidatas, puedeCrear } = opcionesSelector([existente], [], "Mayorista");

    expect(candidatas).toEqual([existente]);
    expect(puedeCrear).toBe(false);
  });

  test("no ofrece crear un nombre que el lead ya tiene puesto", () => {
    const puesta = tag("mayorista");

    const { candidatas, puedeCrear } = opcionesSelector([puesta], [puesta], "mayorista");

    expect(candidatas).toEqual([]);
    expect(puedeCrear).toBe(false);
  });

  test("un nombre largo se filtra igual que uno corto", () => {
    const largo = tag("clientes de flota municipal con convenio anual");

    const { candidatas, puedeCrear } = opcionesSelector([largo], [], "convenio");

    expect(candidatas).toEqual([largo]);
    expect(puedeCrear).toBe(true);
  });
});
