import { describe, expect, it } from "vitest";
import {
  agregarNodo,
  aplicarArreglo,
  destinosPosibles,
  quitarNodoCosiendo,
  salidasSueltas,
} from "@/lib/workflows/arreglos";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import type { Grafo, Nodo, NodoTipo } from "@/types/workflows";
import { arista, grafo } from "./fixtures-grafo";

/**
 * Los arreglos de un clic del editor. Cada uno es una transformación real del
 * grafo: lo que se prueba es el grafo que queda, y que el problema que venía a
 * resolver deja de estar en `validarGrafo`.
 */

function n(id: string, tipo: NodoTipo, x = 0, y = 0): Nodo {
  return { id, tipo, config: {}, posicion: { x, y } };
}

function reglas(g: Grafo): string[] {
  return validarGrafo(g).map((p) => p.regla);
}

describe("salidasSueltas", () => {
  it("lista los puertos del nodo que no llevan a ningún lado", () => {
    const g = grafo(
      [n("t", "trigger_manual"), n("c", "logica_condicion"), n("f", "logica_detener")],
      [arista("t", "c"), arista("c", "f", "verdadero")],
    );
    expect(salidasSueltas(g, "c")).toEqual(["falso"]);
    expect(salidasSueltas(g, "t")).toEqual([]);
    // Detener no tiene puertos: nunca tiene una salida suelta.
    expect(salidasSueltas(g, "f")).toEqual([]);
  });
});

describe("aplicarArreglo: agregar_detener", () => {
  it("agrega un Detener debajo del nodo y lo conecta por el puerto suelto", () => {
    const g = grafo(
      [n("n1", "trigger_manual", 0, 0), n("n2", "crm_etiqueta_add", 0, 144)],
      [arista("n1", "n2")],
    );
    expect(reglas(g)).toContain("salida_sin_conectar");

    const { grafo: r, nodoNuevo } = aplicarArreglo(g, {
      tipo: "agregar_detener",
      desde: "n2",
      puerto: "salida",
    });

    expect(nodoNuevo).toBe("n3");
    const detener = r.nodos.find((x) => x.id === "n3");
    expect(detener?.tipo).toBe("logica_detener");
    expect(detener?.posicion.y).toBeGreaterThan(144);
    expect(r.aristas).toContainEqual({ desde: "n2", hasta: "n3", puerto: "salida" });
    expect(reglas(r)).not.toContain("salida_sin_conectar");
    expect(validarGrafo(r)).toEqual([]);
  });

  it("en una condición conecta el puerto que falta y deja el otro como estaba", () => {
    const g = grafo(
      [n("n1", "trigger_manual"), n("n2", "logica_condicion", 0, 144), n("n3", "logica_detener")],
      [arista("n1", "n2"), arista("n2", "n3", "verdadero")],
    );
    const { grafo: r } = aplicarArreglo(g, {
      tipo: "agregar_detener",
      desde: "n2",
      puerto: "falso",
    });
    expect(r.aristas).toContainEqual({ desde: "n2", hasta: "n4", puerto: "falso" });
    expect(r.aristas).toContainEqual({ desde: "n2", hasta: "n3", puerto: "verdadero" });
    expect(validarGrafo(r)).toEqual([]);
  });

  it("no pisa un nodo que ya está donde iría el Detener", () => {
    const g = grafo(
      [
        n("n1", "trigger_manual", 0, 0),
        n("n2", "crm_etiqueta_add", 0, 144),
        n("n3", "logica_detener", 0, 288),
      ],
      [arista("n1", "n2")],
    );
    const { grafo: r } = aplicarArreglo(g, {
      tipo: "agregar_detener",
      desde: "n2",
      puerto: "salida",
    });
    const nuevo = r.nodos.find((x) => x.id === "n4")!;
    const ocupado = g.nodos.find((x) => x.id === "n3")!;
    const dx = Math.abs(nuevo.posicion.x - ocupado.posicion.x);
    const dy = Math.abs(nuevo.posicion.y - ocupado.posicion.y);
    expect(dx >= 216 || dy >= 144).toBe(true);
    expect(nuevo.posicion.x % 16).toBe(0);
    expect(nuevo.posicion.y % 16).toBe(0);
  });

  it("no toca el grafo que recibe", () => {
    const g = grafo([n("n1", "trigger_manual"), n("n2", "msg_texto")], [arista("n1", "n2")]);
    const copia = structuredClone(g);
    aplicarArreglo(g, { tipo: "agregar_detener", desde: "n2", puerto: "salida" });
    expect(g).toEqual(copia);
  });
});

describe("aplicarArreglo: conectar", () => {
  it("conecta el puerto suelto a un nodo que ya existe", () => {
    const g = grafo(
      [n("n1", "trigger_manual"), n("n2", "msg_texto"), n("n3", "logica_detener")],
      [arista("n1", "n2")],
    );
    const { grafo: r, nodoNuevo } = aplicarArreglo(g, {
      tipo: "conectar",
      desde: "n2",
      puerto: "salida",
      hasta: "n3",
    });
    expect(nodoNuevo).toBeUndefined();
    expect(r.aristas).toContainEqual({ desde: "n2", hasta: "n3", puerto: "salida" });
    expect(validarGrafo(r)).toEqual([]);
  });

  it("no duplica una línea que ya existe", () => {
    const g = grafo([n("n1", "trigger_manual"), n("n2", "logica_detener")], [arista("n1", "n2")]);
    const { grafo: r } = aplicarArreglo(g, {
      tipo: "conectar",
      desde: "n1",
      puerto: "salida",
      hasta: "n2",
    });
    expect(r.aristas).toHaveLength(1);
  });
});

describe("aplicarArreglo: soltar_aristas_al_disparador", () => {
  it("saca las líneas que vuelven al disparador y nada más", () => {
    const g = grafo(
      [n("n1", "trigger_manual"), n("n2", "logica_esperar"), n("n3", "logica_detener")],
      [arista("n1", "n2"), arista("n2", "n1"), arista("n2", "n3")],
    );
    expect(reglas(g)).toContain("disparador_sin_entrantes");
    const { grafo: r } = aplicarArreglo(g, {
      tipo: "soltar_aristas_al_disparador",
      disparadorId: "n1",
    });
    expect(r.aristas).toEqual([arista("n1", "n2"), arista("n2", "n3")]);
    expect(reglas(r)).not.toContain("disparador_sin_entrantes");
  });
});

describe("aplicarArreglo: soltar_aristas_colgadas", () => {
  it("saca las líneas que apuntan a un paso que no existe", () => {
    const g = grafo(
      [n("n1", "trigger_manual"), n("n2", "logica_detener")],
      [arista("n1", "n2"), arista("n1", "fantasma")],
    );
    expect(reglas(g)).toContain("arista_a_nodo_inexistente");
    const { grafo: r } = aplicarArreglo(g, { tipo: "soltar_aristas_colgadas" });
    expect(r.aristas).toEqual([arista("n1", "n2")]);
    expect(validarGrafo(r)).toEqual([]);
  });
});

describe("aplicarArreglo: quitar_nodo (cose la línea)", () => {
  it("borra el bloque y une lo que entraba con lo que seguía, conservando el puerto", () => {
    const g = grafo(
      [
        n("n1", "trigger_manual"),
        n("n2", "logica_condicion"),
        n("n3", "int_notif_vendedor"),
        n("n4", "logica_detener"),
        n("n5", "logica_detener"),
      ],
      [
        arista("n1", "n2"),
        arista("n2", "n3", "verdadero"),
        arista("n3", "n4"),
        arista("n2", "n5", "falso"),
      ],
    );
    const { grafo: r } = aplicarArreglo(g, { tipo: "quitar_nodo", nodoId: "n3" });
    expect(r.nodos.map((x) => x.id)).toEqual(["n1", "n2", "n4", "n5"]);
    expect(r.aristas).toContainEqual({ desde: "n2", hasta: "n4", puerto: "verdadero" });
    expect(r.aristas.some((a) => a.desde === "n3" || a.hasta === "n3")).toBe(false);
    expect(validarGrafo(r)).toEqual([]);
  });

  it("un bloque del final se va sin coser nada", () => {
    const g = grafo([n("n1", "trigger_manual"), n("n2", "msg_texto")], [arista("n1", "n2")]);
    expect(quitarNodoCosiendo(g, "n2")).toEqual(grafo([n("n1", "trigger_manual")], []));
  });
});

describe("agregarNodo", () => {
  it("crea el bloque en la posición pedida con el primer id libre", () => {
    const g = grafo([n("n1", "trigger_manual"), n("n3", "msg_texto")], [arista("n1", "n3")]);
    const { grafo: r, id } = agregarNodo(g, {
      tipo: "logica_detener",
      posicion: { x: 32, y: 400 },
    });
    expect(id).toBe("n2");
    expect(r.nodos.find((x) => x.id === "n2")).toEqual({
      id: "n2",
      tipo: "logica_detener",
      config: {},
      posicion: { x: 32, y: 400 },
    });
    expect(r.aristas).toEqual(g.aristas);
  });

  it("con origen, lo deja conectado al puerto del que salió el cable", () => {
    const g = grafo(
      [n("n1", "trigger_manual"), n("n2", "logica_condicion"), n("n3", "logica_detener")],
      [arista("n1", "n2"), arista("n2", "n3", "verdadero")],
    );
    const { grafo: r, id } = agregarNodo(g, {
      tipo: "msg_texto",
      posicion: { x: 300, y: 300 },
      desde: { nodoId: "n2", puerto: "falso" },
    });
    expect(r.aristas).toContainEqual({ desde: "n2", hasta: id, puerto: "falso" });
  });

  it("un origen que no existe o un puerto que el nodo no tiene no inventa una línea", () => {
    const g = grafo([n("n1", "trigger_manual")], []);
    const a = agregarNodo(g, {
      tipo: "msg_texto",
      posicion: { x: 0, y: 0 },
      desde: { nodoId: "nada", puerto: "salida" },
    });
    expect(a.grafo.aristas).toEqual([]);
    const b = agregarNodo(g, {
      tipo: "msg_texto",
      posicion: { x: 0, y: 0 },
      desde: { nodoId: "n1", puerto: "verdadero" },
    });
    expect(b.grafo.aristas).toEqual([]);
  });
});

describe("destinosPosibles", () => {
  it("ofrece todo paso salvo el mismo nodo y los disparadores", () => {
    const g = grafo(
      [n("n1", "trigger_manual"), n("n2", "msg_texto"), n("n3", "logica_detener")],
      [arista("n1", "n2")],
    );
    expect(destinosPosibles(g, "n2").map((x) => x.id)).toEqual(["n3"]);
  });
});
