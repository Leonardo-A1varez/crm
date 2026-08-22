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

  it("condicion_puertos: la rama falso faltante reporta un solo problema, no dos", () => {
    // Pinnea la decisión: `condicion_puertos` es la única dueña de los puertos
    // de una condición. Si `salida_sin_conectar` volviera a mirar nodos
    // `condicion`, este test detecta el doble reporte del mismo defecto.
    const g = grafo(
      [nodo("d", "disparador"), nodo("c", "condicion"), nodo("f", "fin")],
      [arista("d", "c"), arista("c", "f", "verdadero")],
    );
    const problemas = validarGrafo(g);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.regla).toBe("condicion_puertos");
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

describe("validarGrafo — ciclo_sin_espera no depende del orden del array", () => {
  // Repro del hallazgo del review: un back edge cierra varios ciclos
  // distintos según qué camino lo alcanzó primero. Un DFS que marca cada
  // nodo visitado una sola vez ("negro") deja de explorar el resto de los
  // caminos hacia ese nodo — si el primer camino pasaba por una espera, el
  // ciclo sin espera que comparte el mismo back edge nunca se examinaba.
  //
  // Grafo: d -> x ; x -> w (espera) ; x -> c1 ; w -> c2 ; c1 -> c2 ; c2 -> x
  // El ciclo x -> c1 -> c2 -> x no toca ninguna espera y tiene que reportarse
  // sin importar en qué orden aparecen las dos aristas que salen de "x".
  const nodosRepro = [
    nodo("d", "disparador"),
    nodo("x", "accion"),
    nodo("w", "espera"),
    nodo("c1", "accion"),
    nodo("c2", "accion"),
  ];

  it("reporta el ciclo sin espera cuando x -> w aparece antes que x -> c1", () => {
    const g = grafo(nodosRepro, [
      arista("d", "x"),
      arista("x", "w"),
      arista("x", "c1"),
      arista("w", "c2"),
      arista("c1", "c2"),
      arista("c2", "x"),
    ]);
    const problemas = validarGrafo(g);
    expect(problemas.map((p) => p.regla)).toContain("ciclo_sin_espera");
    const ciclo = problemas.find((p) => p.regla === "ciclo_sin_espera");
    expect(ciclo?.nodos).toEqual(expect.arrayContaining(["x", "c1", "c2"]));
    expect(ciclo?.nodos).not.toContain("w");
  });

  it("mismo grafo, con x -> c1 antes que x -> w: mismo veredicto", () => {
    const g = grafo(nodosRepro, [
      arista("d", "x"),
      arista("x", "c1"),
      arista("x", "w"),
      arista("w", "c2"),
      arista("c1", "c2"),
      arista("c2", "x"),
    ]);
    const problemas = validarGrafo(g);
    expect(problemas.map((p) => p.regla)).toContain("ciclo_sin_espera");
    const ciclo = problemas.find((p) => p.regla === "ciclo_sin_espera");
    expect(ciclo?.nodos).toEqual(expect.arrayContaining(["x", "c1", "c2"]));
  });

  it("un self-loop sin espera se reporta", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("a", "accion")],
      [arista("d", "a"), arista("a", "a")],
    );
    expect(reglas(g)).toContain("ciclo_sin_espera");
  });

  it("dos ciclos sin espera disjuntos se reportan los dos", () => {
    const g = grafo(
      [
        nodo("d", "disparador"),
        nodo("a1", "accion"),
        nodo("a2", "accion"),
        nodo("b1", "accion"),
        nodo("b2", "accion"),
      ],
      [
        arista("d", "a1"),
        arista("a1", "a2"),
        arista("a2", "a1"),
        arista("d", "b1"),
        arista("b1", "b2"),
        arista("b2", "b1"),
      ],
    );
    const problemas = validarGrafo(g).filter((p) => p.regla === "ciclo_sin_espera");
    expect(problemas).toHaveLength(2);
    const todosLosNodos = problemas.flatMap((p) => p.nodos);
    expect(todosLosNodos).toEqual(expect.arrayContaining(["a1", "a2", "b1", "b2"]));
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
