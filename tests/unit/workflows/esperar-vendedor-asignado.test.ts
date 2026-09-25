import { describe, expect, it } from "vitest";
import { disparadorMatch, disparoCoincide } from "@/lib/workflows/recorrer";
import { problemasParaPublicar } from "@/lib/workflows/validar-workflow";
import { eventoQueEspera } from "@/server/services/workflows/ejecutor.service";
import type { Grafo, Nodo, NodoTipo } from "@/types/workflows";

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

describe("«vendedor asignado» tiene emisor", () => {
  it("«Esperar evento: vendedor asignado» se despierta con ese disparo", () => {
    expect(
      eventoQueEspera(nodo("e", "logica_esperar_evento", { evento: "vendedor_asignado" })),
    ).toEqual({ tipo: "evento", disparador: "vendedor_asignado" });
  });

  it("«comprobante subido» sigue sin emisor: esperarlo no se arma", () => {
    expect(
      eventoQueEspera(nodo("e", "logica_esperar_evento", { evento: "comprobante_subido" })),
    ).toBeNull();
  });

  function flujoQueEspera(config: Record<string, unknown>): Grafo {
    return {
      nodos: [
        nodo("t", "trigger_manual"),
        nodo("e", "logica_esperar_evento", config),
        nodo("f", "logica_detener"),
      ],
      aristas: [
        { desde: "t", hasta: "e", puerto: "salida" },
        { desde: "e", hasta: "f", puerto: "salida" },
      ],
    };
  }

  it("publicar una espera de «vendedor asignado» no tiene problemas", () => {
    expect(problemasParaPublicar(flujoQueEspera({ evento: "vendedor_asignado" }))).toEqual([]);
  });

  it("publicar una espera de un evento que nadie emite, o de ninguno, se rechaza", () => {
    // Antes pasaba el validador y fallaba recién al correr.
    for (const config of [{ evento: "comprobante_subido" }, {}]) {
      const problemas = problemasParaPublicar(flujoQueEspera(config));
      expect(problemas.map((p) => p.nodoId)).toEqual(["e"]);
    }
  });

  it("el trigger «Vendedor asignado» escucha ese disparo", () => {
    const g: Grafo = {
      nodos: [nodo("t", "trigger_vendedor_asignado"), nodo("f", "logica_detener")],
      aristas: [{ desde: "t", hasta: "f", puerto: "salida" }],
    };
    expect(disparadorMatch(g, "vendedor_asignado")).toBe(true);
    expect(disparoCoincide(g, "vendedor_asignado", {})).toBe(true);
  });
});
