import { describe, expect, it } from "vitest";
import {
  esAtajoBuscar,
  esCampoEditable,
  siguienteNodo,
} from "@/components/workflows/editor/atajos";

const nodos = [
  { id: "b", position: { x: 300, y: 0 } },
  { id: "a", position: { x: 0, y: 0 } },
  { id: "c", position: { x: 0, y: 144 } },
];

describe("siguienteNodo", () => {
  it("recorre en orden de lectura: de arriba abajo y de izquierda a derecha", () => {
    expect(siguienteNodo(nodos, null, false)).toBe("a");
    expect(siguienteNodo(nodos, "a", false)).toBe("b");
    expect(siguienteNodo(nodos, "b", false)).toBe("c");
  });

  it("al final devuelve null, para que Tab salga del lienzo y no lo atrape", () => {
    expect(siguienteNodo(nodos, "c", false)).toBeNull();
    expect(siguienteNodo(nodos, "a", true)).toBeNull();
  });

  it("hacia atrás con Shift", () => {
    expect(siguienteNodo(nodos, "c", true)).toBe("b");
    expect(siguienteNodo(nodos, null, true)).toBe("c");
  });

  it("sin nodos no hay a dónde ir", () => {
    expect(siguienteNodo([], null, false)).toBeNull();
  });
});

describe("esCampoEditable", () => {
  it("reconoce los campos donde se escribe", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const hijo = document.createElement("span");
    editable.append(hijo);
    document.body.append(editable);
    expect(esCampoEditable(input)).toBe(true);
    expect(esCampoEditable(textarea)).toBe(true);
    expect(esCampoEditable(hijo)).toBe(true);
    expect(esCampoEditable(document.createElement("button"))).toBe(false);
    expect(esCampoEditable(null)).toBe(false);
    editable.remove();
  });

  it("un checkbox no es un campo de texto", () => {
    const check = document.createElement("input");
    check.type = "checkbox";
    expect(esCampoEditable(check)).toBe(false);
  });
});

describe("esAtajoBuscar", () => {
  it("Ctrl+K y ⌘K, sin otras teclas", () => {
    expect(
      esAtajoBuscar({ key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }),
    ).toBe(true);
    expect(
      esAtajoBuscar({ key: "K", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }),
    ).toBe(true);
    expect(
      esAtajoBuscar({ key: "k", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }),
    ).toBe(false);
    expect(
      esAtajoBuscar({ key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }),
    ).toBe(false);
  });
});
