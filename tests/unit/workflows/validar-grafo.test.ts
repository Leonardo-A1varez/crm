import { describe, expect, it } from "vitest";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import { arista, grafo, grafoValido, nodo } from "./fixtures-grafo";
import type { ReglaValidacion } from "@/types/workflows";

const reglas = (g: Parameters<typeof validarGrafo>[0]): ReglaValidacion[] =>
  validarGrafo(g).map((p) => p.regla);

describe("validarGrafo — el caso sano", () => {
  it("un grafo valido no reporta nada", () => {
    expect(validarGrafo(grafoValido())).toEqual([]);
  });
});

describe("validarGrafo — una prueba por regla", () => {
  it("disparador_unico: cero disparadores", () => {
    const g = grafo([nodo("a", "accion"), nodo("f", "fin")], [arista("a", "f")]);
    expect(reglas(g)).toContain("disparador_unico");
  });

  it("disparador_unico: dos disparadores", () => {
    const g = grafo(
      [nodo("d1", "disparador"), nodo("d2", "disparador"), nodo("f", "fin")],
      [arista("d1", "f"), arista("d2", "f")],
    );
    expect(reglas(g)).toContain("disparador_unico");
  });

  it("disparador_sin_entrantes: una arista apunta al disparador", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("a", "accion"), nodo("f", "fin")],
      [arista("d", "a"), arista("a", "d"), arista("a", "f")],
    );
    expect(reglas(g)).toContain("disparador_sin_entrantes");
  });

  it("nodo_inalcanzable: un nodo huerfano", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("f", "fin"), nodo("huerfano", "accion"), nodo("f2", "fin")],
      [arista("d", "f"), arista("huerfano", "f2")],
    );
    const problemas = validarGrafo(g);
    expect(problemas.map((p) => p.regla)).toContain("nodo_inalcanzable");
    const inalcanzable = problemas.find((p) => p.regla === "nodo_inalcanzable");
    expect(inalcanzable?.nodos).toContain("huerfano");
  });

  it("salida_sin_conectar: una accion sin salida", () => {
    const g = grafo([nodo("d", "disparador"), nodo("a", "accion")], [arista("d", "a")]);
    expect(reglas(g)).toContain("salida_sin_conectar");
  });

  it("arista_a_nodo_inexistente", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("f", "fin")],
      [arista("d", "f"), arista("f", "fantasma")],
    );
    expect(reglas(g)).toContain("arista_a_nodo_inexistente");
  });

  it("condicion_puertos: falta la rama falso", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("c", "condicion"), nodo("f", "fin")],
      [arista("d", "c"), arista("c", "f", "verdadero")],
    );
    expect(reglas(g)).toContain("condicion_puertos");
  });

  it("condicion_puertos: dos aristas por el mismo puerto es indeterminista", () => {
    const g = grafo(
      [
        nodo("d", "disparador"),
        nodo("c", "condicion"),
        nodo("f1", "fin"),
        nodo("f2", "fin"),
        nodo("f3", "fin"),
      ],
      [
        arista("d", "c"),
        arista("c", "f1", "verdadero"),
        arista("c", "f2", "verdadero"),
        arista("c", "f3", "falso"),
      ],
    );
    expect(reglas(g)).toContain("condicion_puertos");
  });

  it("ciclo_sin_espera: dos acciones que se apuntan giran en milisegundos", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("a1", "accion"), nodo("a2", "accion")],
      [arista("d", "a1"), arista("a1", "a2"), arista("a2", "a1")],
    );
    const problemas = validarGrafo(g);
    expect(problemas.map((p) => p.regla)).toContain("ciclo_sin_espera");
    const ciclo = problemas.find((p) => p.regla === "ciclo_sin_espera");
    expect(ciclo?.nodos).toEqual(expect.arrayContaining(["a1", "a2"]));
  });
});

describe("validarGrafo — validos que parecen invalidos", () => {
  it("un ciclo CON espera es valido: es el caso real de insistir cada 2 dias", () => {
    const g = grafo(
      [
        nodo("d", "disparador"),
        nodo("e", "espera"),
        nodo("a", "accion"),
        nodo("c", "condicion"),
        nodo("f", "fin"),
      ],
      [
        arista("d", "e"),
        arista("e", "a"),
        arista("a", "c"),
        arista("c", "f", "verdadero"),
        arista("c", "e", "falso"),
      ],
    );
    expect(validarGrafo(g)).toEqual([]);
  });

  it("dos ramas que se vuelven a unir no son un ciclo", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("c", "condicion"), nodo("a", "accion"), nodo("f", "fin")],
      [
        arista("d", "c"),
        arista("c", "a", "verdadero"),
        arista("c", "f", "falso"),
        arista("a", "f"),
      ],
    );
    expect(validarGrafo(g)).toEqual([]);
  });

  it("varias aristas entrantes al mismo nodo son validas", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("c", "condicion"), nodo("a1", "accion"), nodo("f", "fin")],
      [
        arista("d", "c"),
        arista("c", "a1", "verdadero"),
        arista("c", "a1", "falso"),
        arista("a1", "f"),
      ],
    );
    expect(validarGrafo(g)).toEqual([]);
  });
});

describe("validarGrafo — devuelve TODOS los problemas", () => {
  it("dos problemas distintos vienen los dos, no solo el primero", () => {
    // Sin disparador Y con una arista a un nodo que no existe.
    const g = grafo([nodo("a", "accion"), nodo("f", "fin")], [arista("a", "f"), arista("f", "x")]);
    const rs = reglas(g);
    expect(rs).toContain("disparador_unico");
    expect(rs).toContain("arista_a_nodo_inexistente");
  });
});
