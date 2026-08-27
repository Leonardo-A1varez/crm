import { describe, expect, it, vi } from "vitest";
import { ejecutarWorkflow } from "@/lib/workflows/engine/ejecutar-workflow";
import type { EjecucionCallbacks } from "@/lib/workflows/engine/ejecutar-workflow";
import type { Grafo } from "@/types/workflows";
import type { WorkflowVersion } from "@/types/entities";

function version(grafo: Grafo, overrides: Partial<WorkflowVersion> = {}): WorkflowVersion {
  return {
    id: "version-1",
    workflow_id: "workflow-1",
    version: 1,
    grafo,
    max_pasos: 50,
    publicada: false,
    created_at: new Date(),
    created_by: null,
    politica_concurrencia: "ignorar",
    ...overrides,
  };
}

function callbacksEspia(): EjecucionCallbacks {
  return {
    persistirEstado: vi.fn().mockResolvedValue(undefined),
    persistirPaso: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ejecutarWorkflow — encuentra el trigger del catálogo nuevo", () => {
  it("trigger_manual -> msg_texto -> logica_detener completa de punta a punta", async () => {
    const grafo: Grafo = {
      nodos: [
        { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
        {
          id: "m",
          tipo: "msg_texto",
          config: { mensaje: "hola" },
          posicion: { x: 0, y: 100 },
        },
        { id: "fin", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 200 } },
      ],
      aristas: [
        { desde: "t", hasta: "m", puerto: "salida" },
        { desde: "m", hasta: "fin", puerto: "salida" },
      ],
    };

    const resultado = await ejecutarWorkflow(
      version(grafo),
      { trigger: { tipo: "manual", datos: {} } },
      callbacksEspia(),
    );

    expect(resultado.tipo).toBe("completado");
    if (resultado.tipo === "completado") {
      expect(resultado.pasos).toBe(3);
    }
  });

  it("reconoce 'disparador' (legacy) como trigger, aunque no haya handler para ejecutarlo", async () => {
    // No hay handler registrado para ningún tipo legacy (disparador/accion/
    // condicion/espera/fin) — solo para el catálogo de 57 tipos. El canvas
    // real nunca genera nodos legacy, así que esto no ejecuta de punta a
    // punta; lo que importa acá es que NO falle con "grafo_invalido" (el bug
    // de encontrarTrigger que se está arreglando), sino con "accion_fallo"
    // por falta de handler — una limitación preexistente y distinta.
    const grafo: Grafo = {
      nodos: [
        { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
        { id: "fin", tipo: "fin", config: {}, posicion: { x: 0, y: 100 } },
      ],
      aristas: [{ desde: "d", hasta: "fin", puerto: "salida" }],
    };

    const resultado = await ejecutarWorkflow(
      version(grafo),
      { trigger: { tipo: "manual", datos: {} } },
      callbacksEspia(),
    );

    expect(resultado.tipo).toBe("fallado");
    if (resultado.tipo === "fallado") {
      expect(resultado.motivo).not.toBe("grafo_invalido");
    }
  });

  it("sin ningun nodo trigger reconocible, falla con motivo grafo_invalido", async () => {
    const grafo: Grafo = {
      nodos: [
        { id: "m", tipo: "msg_texto", config: { mensaje: "hola" }, posicion: { x: 0, y: 0 } },
      ],
      aristas: [],
    };

    const resultado = await ejecutarWorkflow(
      version(grafo),
      { trigger: { tipo: "manual", datos: {} } },
      callbacksEspia(),
    );

    expect(resultado.tipo).toBe("fallado");
    if (resultado.tipo === "fallado") {
      expect(resultado.error).toContain("disparador");
    }
  });
});
