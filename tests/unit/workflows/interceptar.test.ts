import { describe, expect, test } from "vitest";
import {
  camposDelPrefijo,
  decidirPrefijo,
  esInterceptor,
  ganadorEntre,
} from "@/lib/workflows/interceptar";
import type { Grafo, Nodo } from "@/types/workflows";

/**
 * Decidir si un flujo "intercepta el LLM" para ESTE mensaje: el trigger
 * "Mensaje recibido" está marcado, sus filtros coinciden y el recorrido desde
 * el trigger —atravesando sólo condiciones, que no tienen efectos— llega a una
 * acción del flujo y no a un "Detener".
 */

const trigger = (config: Record<string, unknown> = { interceptaLlm: true }): Nodo => ({
  id: "t",
  tipo: "trigger_mensaje",
  config,
  posicion: { x: 0, y: 0 },
});

const nodo = (id: string, tipo: Nodo["tipo"], config: Record<string, unknown> = {}): Nodo => ({
  id,
  tipo,
  config,
  posicion: { x: 0, y: 0 },
});

const condicionIntent = (intentId: string) => ({
  arbol: {
    id: "raiz",
    clase: "grupo",
    operador: "y",
    hijos: [
      {
        id: "f1",
        clase: "regla",
        campoId: "sesion.intent",
        comparador: "es",
        valor: { tipo: "opcion", valor: intentId },
      },
    ],
  },
});

const condicionCanal = (canal: string) => ({
  arbol: {
    id: "raiz",
    clase: "grupo",
    operador: "y",
    hijos: [
      {
        id: "f1",
        clase: "regla",
        campoId: "lead.canal",
        comparador: "es",
        valor: { tipo: "opcion", valor: canal },
      },
    ],
  },
});

/** Mensaje recibido → Condición → (sí) Enviar mensaje · (no) Detener. */
function responderAutomatico(condicion: Record<string, unknown>, disparador = trigger()): Grafo {
  return {
    nodos: [
      disparador,
      nodo("c", "logica_condicion", condicion),
      nodo("m", "msg_texto", { mensaje: "Abrimos de 9 a 18" }),
      nodo("d", "logica_detener"),
      nodo("d2", "logica_detener"),
    ],
    aristas: [
      { desde: "t", hasta: "c", puerto: "salida" },
      { desde: "c", hasta: "m", puerto: "verdadero" },
      { desde: "c", hasta: "d", puerto: "falso" },
      { desde: "m", hasta: "d2", puerto: "salida" },
    ],
  };
}

const ahora = { ahora: new Date("2026-09-26T15:00:00Z"), zona: "UTC" };

describe("esInterceptor", () => {
  test("sólo el trigger «Mensaje recibido» marcado intercepta", () => {
    expect(esInterceptor(responderAutomatico(condicionCanal("wa")))).toBe(true);
    expect(esInterceptor(responderAutomatico(condicionCanal("wa"), trigger({})))).toBe(false);
    const etiqueta: Grafo = {
      nodos: [nodo("t", "trigger_etiqueta", { tagId: "x", interceptaLlm: true })],
      aristas: [],
    };
    expect(esInterceptor(etiqueta)).toBe(false);
  });
});

describe("decidirPrefijo", () => {
  test("la condición se cumple y lleva a una acción: intercepta", () => {
    const grafo = responderAutomatico(condicionCanal("wa"));
    expect(decidirPrefijo(grafo, { lead: { canal: "wa" } }, ahora, true)).toBe("intercepta");
  });

  test("la condición no se cumple y lleva a Detener: no intercepta", () => {
    const grafo = responderAutomatico(condicionCanal("wa"));
    expect(decidirPrefijo(grafo, { lead: { canal: "ig" } }, ahora, true)).toBe("no");
  });

  test("una condición sobre el intent sin clasificar todavía pide el intent", () => {
    const grafo = responderAutomatico(condicionIntent("i-horario"));
    expect(decidirPrefijo(grafo, {}, ahora, false)).toBe("necesita_intent");
    expect(decidirPrefijo(grafo, { sesion: { intent: "i-horario" } }, ahora, true)).toBe(
      "intercepta",
    );
    expect(decidirPrefijo(grafo, { sesion: { intent: "otro" } }, ahora, true)).toBe("no");
  });

  test("sin condición: el trigger lleva directo a una acción", () => {
    const grafo: Grafo = {
      nodos: [trigger(), nodo("m", "msg_texto", { mensaje: "hola" }), nodo("d", "logica_detener")],
      aristas: [
        { desde: "t", hasta: "m", puerto: "salida" },
        { desde: "m", hasta: "d", puerto: "salida" },
      ],
    };
    expect(decidirPrefijo(grafo, {}, ahora, false)).toBe("intercepta");
  });

  test("delegar al agente no intercepta: el que contesta es el agente", () => {
    const grafo: Grafo = {
      nodos: [trigger(), nodo("ia", "ia_delegar")],
      aristas: [{ desde: "t", hasta: "ia", puerto: "salida" }],
    };
    expect(decidirPrefijo(grafo, {}, ahora, false)).toBe("no");
  });

  test("una condición mal guardada falla hacia el agente, no hacia el silencio", () => {
    const grafo = responderAutomatico({ arbol: { roto: true } });
    expect(decidirPrefijo(grafo, {}, ahora, true)).toBe("no");
  });

  test("un ciclo de condiciones no cuelga: no intercepta", () => {
    const grafo: Grafo = {
      nodos: [
        trigger(),
        nodo("c1", "logica_condicion", condicionCanal("wa")),
        nodo("c2", "logica_condicion", condicionCanal("wa")),
      ],
      aristas: [
        { desde: "t", hasta: "c1", puerto: "salida" },
        { desde: "c1", hasta: "c2", puerto: "verdadero" },
        { desde: "c1", hasta: "c2", puerto: "falso" },
        { desde: "c2", hasta: "c1", puerto: "verdadero" },
        { desde: "c2", hasta: "c1", puerto: "falso" },
      ],
    };
    expect(decidirPrefijo(grafo, { lead: { canal: "wa" } }, ahora, true)).toBe("no");
  });
});

describe("camposDelPrefijo", () => {
  test("junta los campos vivos de las condiciones del prefijo, sin el intent", () => {
    const grafo = responderAutomatico({
      arbol: {
        id: "raiz",
        clase: "grupo",
        operador: "o",
        hijos: [
          {
            id: "f1",
            clase: "regla",
            campoId: "sesion.intent",
            comparador: "es",
            valor: { tipo: "opcion", valor: "i" },
          },
          {
            id: "f2",
            clase: "regla",
            campoId: "lead.etiquetas",
            comparador: "tiene",
            valor: { tipo: "opciones", valores: ["tag-1"] },
          },
        ],
      },
    });
    expect([...camposDelPrefijo(grafo)]).toEqual(["lead.etiquetas"]);
  });
});

describe("ganadorEntre", () => {
  test("gana la versión publicada hace más tiempo; desempata el id del flujo", () => {
    const v = (workflow_id: string, fecha: string) => ({
      workflow_id,
      created_at: new Date(fecha),
    });
    expect(
      ganadorEntre([
        v("b", "2026-09-20T00:00:00Z"),
        v("a", "2026-09-10T00:00:00Z"),
        v("c", "2026-09-10T00:00:00Z"),
      ])?.workflow_id,
    ).toBe("a");
    expect(ganadorEntre([])).toBeNull();
  });
});
