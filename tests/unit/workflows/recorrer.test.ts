import { describe, expect, it } from "vitest";
import { disparadorDe, disparadorMatch, nodoPorId, siguienteNodo } from "@/lib/workflows/recorrer";
import type { Grafo, Nodo, NodoTipo } from "@/types/workflows";

const grafo: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "c", tipo: "condicion", config: {}, posicion: { x: 0, y: 0 } },
    { id: "si", tipo: "accion", config: {}, posicion: { x: 0, y: 0 } },
    { id: "no", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
  ],
  aristas: [
    { desde: "d", hasta: "c", puerto: "salida" },
    { desde: "c", hasta: "si", puerto: "verdadero" },
    { desde: "c", hasta: "no", puerto: "falso" },
  ],
};

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

/** Un grafo del canvas: el disparador es un `trigger_*`, nunca el `disparador` legacy. */
function grafoConTrigger(tipo: NodoTipo, config: Record<string, unknown> = {}): Grafo {
  return {
    nodos: [nodo("t", tipo, config), nodo("fin", "logica_detener")],
    aristas: [{ desde: "t", hasta: "fin", puerto: "salida" }],
  };
}

describe("recorrer", () => {
  it("sigue el puerto que se le pide, no el primero que encuentra", () => {
    expect(siguienteNodo(grafo, "c", "verdadero")).toBe("si");
    expect(siguienteNodo(grafo, "c", "falso")).toBe("no");
  });

  it("devuelve undefined cuando el puerto no tiene arista", () => {
    expect(siguienteNodo(grafo, "no", "salida")).toBeUndefined();
  });

  it("encuentra el nodo por id y el disparador", () => {
    expect(nodoPorId(grafo, "si")?.tipo).toBe("accion");
    expect(nodoPorId(grafo, "nope")).toBeUndefined();
    expect(disparadorDe(grafo)?.id).toBe("d");
  });

  // Corte 2 de la Fase 0: la paleta inserta `trigger_*`, y buscar solo el tipo
  // legacy dejaba a todo grafo del canvas sin disparador.
  it("encuentra el disparador de un grafo armado en el canvas", () => {
    expect(disparadorDe(grafoConTrigger("trigger_mensaje"))?.id).toBe("t");
    expect(disparadorDe(grafoConTrigger("trigger_cron"))?.id).toBe("t");
  });
});

describe("disparadorMatch", () => {
  it("un trigger del canvas escucha el evento de dominio que le corresponde", () => {
    expect(disparadorMatch(grafoConTrigger("trigger_mensaje"), "mensaje_recibido")).toBe(true);
    expect(disparadorMatch(grafoConTrigger("trigger_etiqueta"), "etiqueta_asignada")).toBe(true);
    expect(disparadorMatch(grafoConTrigger("trigger_etapa"), "etapa_cambiada")).toBe(true);
  });

  it("un trigger no escucha el evento de otro", () => {
    expect(disparadorMatch(grafoConTrigger("trigger_mensaje"), "etiqueta_asignada")).toBe(false);
    expect(disparadorMatch(grafoConTrigger("trigger_etiqueta"), "mensaje_recibido")).toBe(false);
  });

  it("un trigger sin emisor no matchea ningún evento: no se disparan en silencio", () => {
    for (const disparador of ["mensaje_recibido", "etiqueta_asignada", "etapa_cambiada"]) {
      expect(disparadorMatch(grafoConTrigger("trigger_cron"), disparador)).toBe(false);
      expect(disparadorMatch(grafoConTrigger("trigger_manual"), disparador)).toBe(false);
    }
  });

  it("'Lead creado' y 'Etiqueta removida' escuchan su evento", () => {
    expect(disparadorMatch(grafoConTrigger("trigger_lead_creado"), "lead_creado")).toBe(true);
    expect(disparadorMatch(grafoConTrigger("trigger_etiqueta_removida"), "etiqueta_removida")).toBe(
      true,
    );
  });

  it("'Manual' escucha el disparo manual y nada más", () => {
    expect(disparadorMatch(grafoConTrigger("trigger_manual"), "manual")).toBe(true);
    expect(disparadorMatch(grafoConTrigger("trigger_mensaje"), "manual")).toBe(false);
  });

  // El legacy nunca tuvo emisores dirigidos: un `disparador` con "manual"
  // escucharía cualquier disparo manual sin que nadie lo haya elegido.
  it("el disparador legacy sólo escucha los tres eventos de siempre", () => {
    for (const disparador of ["manual", "programado", "inactividad", "lead_creado"]) {
      const legacy: Grafo = {
        nodos: [nodo("d", "disparador", { disparador }), nodo("f", "fin")],
        aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
      };
      expect(disparadorMatch(legacy, disparador)).toBe(false);
    }
  });

  it("el disparador legacy sigue matcheando por config.disparador", () => {
    const legacy: Grafo = {
      nodos: [nodo("d", "disparador", { disparador: "etapa_cambiada" }), nodo("f", "fin")],
      aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
    };
    expect(disparadorMatch(legacy, "etapa_cambiada")).toBe(true);
    expect(disparadorMatch(legacy, "mensaje_recibido")).toBe(false);
  });
});
