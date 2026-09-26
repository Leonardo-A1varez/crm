import { describe, expect, it } from "vitest";
import { aplicarArreglo } from "@/lib/workflows/arreglos";
import { arreglosDeResolver, problemasDelEditor } from "@/lib/workflows/problemas-editor";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import { problemasParaPublicar } from "@/lib/workflows/validar-workflow";
import type { Grafo, Nodo, NodoTipo } from "@/types/workflows";
import { arista, grafo } from "./fixtures-grafo";

/**
 * Lo que el editor cuelga de cada nodo. Sale de los mismos validadores que
 * Guardar (`validarGrafo`) y Publicar (`validar-workflow.ts`): acá se prueba
 * que cada problema cae sobre el nodo correcto, y que el arreglo que ofrece
 * —cuando ofrece uno— de verdad saca el problema.
 */

function n(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: Number(id.slice(1)) * 144 } };
}

function de(g: Grafo, nodoId: string) {
  return problemasDelEditor(g).porNodo.filter((p) => p.nodoId === nodoId);
}

describe("problemasDelEditor", () => {
  it("un grafo sano y bien configurado no tiene nada", () => {
    const g = grafo(
      [
        n("n1", "trigger_manual"),
        n("n2", "crm_etapa", { etapaId: "cotizado" }),
        n("n3", "logica_detener"),
      ],
      [arista("n1", "n2"), arista("n2", "n3")],
    );
    expect(validarGrafo(g)).toEqual([]);
    expect(problemasParaPublicar(g)).toEqual([]);
    expect(problemasDelEditor(g).porNodo).toEqual([]);
  });

  it("salida sin conectar: sobre el nodo, con «Agregar Detener» que la cierra", () => {
    const g = grafo(
      [n("n1", "trigger_manual"), n("n2", "crm_etapa", { etapaId: "cotizado" })],
      [arista("n1", "n2")],
    );
    const [p, ...resto] = de(g, "n2");
    expect(resto).toEqual([]);
    expect(p?.regla).toBe("salida_sin_conectar");
    expect(p?.arreglos.map((a) => a.arreglo)).toEqual([
      { tipo: "agregar_detener", desde: "n2", puerto: "salida" },
    ]);
    const r = aplicarArreglo(g, p!.arreglos[0]!.arreglo).grafo;
    expect(validarGrafo(r)).toEqual([]);
  });

  it("condición sin «No»: un problema por el puerto que falta, con su arreglo", () => {
    const g = grafo(
      [
        n("n1", "trigger_manual"),
        n("n2", "logica_condicion", { campo: "lead.nombre", operador: "contiene", valor: "a" }),
        n("n3", "logica_detener"),
      ],
      [arista("n1", "n2"), arista("n2", "n3", "verdadero")],
    );
    const ps = de(g, "n2");
    expect(ps).toHaveLength(1);
    expect(ps[0]?.mensaje).toContain("«No»");
    const r = aplicarArreglo(g, ps[0]!.arreglos[0]!.arreglo).grafo;
    expect(validarGrafo(r)).toEqual([]);
  });

  it("condición con dos líneas por «Sí»: lo explica y no ofrece arreglo (¿cuál borrar?)", () => {
    const g = grafo(
      [
        n("n1", "trigger_manual"),
        n("n2", "logica_condicion", { campo: "lead.nombre", operador: "contiene", valor: "a" }),
        n("n3", "logica_detener"),
        n("n4", "logica_detener"),
        n("n5", "logica_detener"),
      ],
      [
        arista("n1", "n2"),
        arista("n2", "n3", "verdadero"),
        arista("n2", "n4", "verdadero"),
        arista("n2", "n5", "falso"),
      ],
    );
    const ps = de(g, "n2");
    expect(ps).toHaveLength(1);
    expect(ps[0]?.arreglos).toEqual([]);
  });

  it("línea que vuelve al disparador: sobre el disparador y el que vuelve, con el arreglo", () => {
    const g = grafo(
      [n("n1", "trigger_manual"), n("n2", "logica_esperar"), n("n3", "logica_detener")],
      [arista("n1", "n2"), arista("n2", "n1"), arista("n2", "n3")],
    );
    expect(de(g, "n1").map((p) => p.regla)).toEqual(["disparador_sin_entrantes"]);
    const [p] = de(g, "n2");
    expect(p?.regla).toBe("disparador_sin_entrantes");
    const r = aplicarArreglo(g, p!.arreglos[0]!.arreglo).grafo;
    expect(validarGrafo(r).map((x) => x.regla)).not.toContain("disparador_sin_entrantes");
  });

  it("paso inalcanzable y ciclo sin espera: se explican sin prometer un arreglo", () => {
    const suelto = grafo(
      [n("n1", "trigger_manual"), n("n2", "logica_detener"), n("n3", "logica_detener")],
      [arista("n1", "n2")],
    );
    expect(de(suelto, "n3").map((p) => [p.regla, p.arreglos.length])).toEqual([
      ["nodo_inalcanzable", 0],
    ]);

    const ciclo = grafo(
      [
        n("n1", "trigger_manual"),
        n("n2", "crm_etapa", { etapaId: "cotizado" }),
        n("n3", "crm_etapa", { etapaId: "negociando" }),
      ],
      [arista("n1", "n2"), arista("n2", "n3"), arista("n3", "n2")],
    );
    for (const id of ["n2", "n3"]) {
      const ps = de(ciclo, id);
      expect(ps.map((p) => p.regla)).toContain("ciclo_sin_espera");
      expect(ps.every((p) => p.arreglos.length === 0)).toBe(true);
    }
  });

  it("dos disparadores: sobre cada uno, sin arreglo; ninguno: problema del flujo", () => {
    const dos = grafo(
      [n("n1", "trigger_manual"), n("n2", "trigger_lead_creado"), n("n3", "logica_detener")],
      [arista("n1", "n3"), arista("n2", "n3")],
    );
    expect(de(dos, "n1").map((p) => p.regla)).toContain("disparador_unico");
    expect(de(dos, "n2").map((p) => p.regla)).toContain("disparador_unico");

    const ninguno = grafo([n("n1", "logica_detener")], []);
    expect(problemasDelEditor(ninguno).delFlujo).toHaveLength(1);
  });

  it("línea a un paso que no existe: sobre el extremo que sí existe, con arreglo", () => {
    const g = grafo(
      [n("n1", "trigger_manual"), n("n2", "logica_detener")],
      [arista("n1", "n2"), arista("n1", "n9")],
    );
    const [p] = de(g, "n1");
    expect(p?.regla).toBe("arista_a_nodo_inexistente");
    const r = aplicarArreglo(g, p!.arreglos[0]!.arreglo).grafo;
    expect(validarGrafo(r)).toEqual([]);
  });

  it("falta de configuración: el mensaje del validador de publicación, sin arreglo del grafo", () => {
    const g = grafo(
      [n("n1", "trigger_manual"), n("n2", "crm_etiqueta_add"), n("n3", "logica_detener")],
      [arista("n1", "n2"), arista("n2", "n3")],
    );
    const ps = de(g, "n2");
    const esperados = problemasParaPublicar(g)
      .filter((x) => x.nodoId === "n2")
      .map((x) => x.mensaje);
    expect(esperados.length).toBeGreaterThan(0);
    expect(ps.map((p) => p.mensaje)).toEqual(esperados);
    expect(ps.every((p) => p.regla === "configuracion" && p.arreglos.length === 0)).toBe(true);
  });

  it("bloque que el motor no ejecuta: ofrece quitarlo y cose la línea", () => {
    const g = grafo(
      [
        n("n1", "trigger_manual"),
        n("n2", "int_notif_grupo", { mensaje: "hola" }),
        n("n3", "logica_detener"),
      ],
      [arista("n1", "n2"), arista("n2", "n3")],
    );
    const [p] = de(g, "n2");
    expect(p?.regla).toBe("no_disponible");
    expect(p?.arreglos.map((a) => a.arreglo)).toEqual([{ tipo: "quitar_nodo", nodoId: "n2" }]);
    const r = aplicarArreglo(g, p!.arreglos[0]!.arreglo).grafo;
    expect(problemasParaPublicar(r)).toEqual([]);
  });

  it("todo nodo con un error de publicar tiene al menos un problema en el editor", () => {
    const g = grafo(
      [
        n("n1", "trigger_manual"),
        n("n2", "crm_etiqueta_add"),
        n("n3", "logica_condicion"),
        n("n4", "msg_botones"),
      ],
      [arista("n1", "n2"), arista("n2", "n3"), arista("n3", "n4", "verdadero")],
    );
    const conProblema = new Set(problemasDelEditor(g).porNodo.map((p) => p.nodoId));
    for (const p of problemasParaPublicar(g)) {
      if (p.nodoId !== null && g.nodos.some((x) => x.id === p.nodoId)) {
        expect(conProblema.has(p.nodoId)).toBe(true);
      }
    }
  });
});

describe("arreglosDeResolver", () => {
  it("junta el primer arreglo de cada problema del nodo, y los aplica todos", () => {
    const g = grafo(
      [
        n("n1", "trigger_manual"),
        n("n2", "logica_condicion", { campo: "lead.nombre", operador: "contiene", valor: "a" }),
      ],
      [arista("n1", "n2")],
    );
    const arreglos = arreglosDeResolver(problemasDelEditor(g).porNodo, "n2");
    expect(arreglos).toHaveLength(2);
    let r = g;
    for (const a of arreglos) r = aplicarArreglo(r, a.arreglo).grafo;
    expect(validarGrafo(r)).toEqual([]);
  });

  it("nunca borra un bloque: quitarlo queda como botón explícito del globo", () => {
    const g = grafo(
      [
        n("n1", "trigger_manual"),
        n("n2", "int_notif_grupo", { mensaje: "hola" }),
        n("n3", "logica_detener"),
      ],
      [arista("n1", "n2"), arista("n2", "n3")],
    );
    expect(arreglosDeResolver(problemasDelEditor(g).porNodo, "n2")).toEqual([]);
  });

  it("sin arreglos automáticos, no hay nada que resolver", () => {
    const g = grafo(
      [n("n1", "trigger_manual"), n("n2", "crm_etiqueta_add"), n("n3", "logica_detener")],
      [arista("n1", "n2"), arista("n2", "n3")],
    );
    expect(arreglosDeResolver(problemasDelEditor(g).porNodo, "n2")).toEqual([]);
  });
});
