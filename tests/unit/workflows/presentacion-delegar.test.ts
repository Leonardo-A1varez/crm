import { describe, expect, it } from "vitest";
import {
  etiquetaDePuertoEnLienzo,
  presentacionDe,
} from "@/app/(panel)/workflows/[id]/_lib/presentacion-nodos";
import { progresoDeDelegacion } from "@/app/(panel)/workflows/[id]/_lib/vista-corrida";
import { tonoDePuerto } from "@/lib/ui/workflow-nodos";
import type { Nodo } from "@/types/workflows";

/**
 * Cómo se ve "Delegar al agente": el nodo con sus cinco salidas en el lienzo y
 * el progreso del tramo en la corrida ("turno 3 · esperando intent …").
 */

const CATALOGOS = { intents: [{ id: "i-cot", nombre: "consulta_producto" }], etiquetas: [] };

const nodo = (config: Record<string, unknown>): Nodo => ({
  id: "d",
  tipo: "ia_delegar",
  config,
  posicion: { x: 0, y: 0 },
});

describe("Delegar al agente en el lienzo", () => {
  it("dibuja las cinco salidas con los rótulos cortos del diseño", () => {
    const p = presentacionDe(nodo({ intentId: "i-cot" }), CATALOGOS);
    expect(p.salidas?.map((s) => s.label)).toEqual([
      "Resuelto",
      "Humano",
      "No pudo",
      "Sin resp.",
      "Error",
    ]);
  });

  it("cada salida tiene el tono de lo que significa", () => {
    expect(["resuelto", "humano", "no_pudo", "sin_respuesta", "error"].map(tonoDePuerto)).toEqual([
      "ok",
      "alerta",
      "falla",
      "neutro",
      "falla",
    ]);
  });

  it("en otro bloque «sin respuesta» se sigue nombrando completo", () => {
    expect(etiquetaDePuertoEnLienzo({ tipo: "msg_botones", config: {} }, "sin_respuesta")).toBe(
      "Sin respuesta",
    );
  });

  it("el resumen dice cuándo vuelve y el tiempo máximo", () => {
    expect(presentacionDe(nodo({ intentId: "i-cot" }), CATALOGOS).resumen).toBe(
      "Vuelve con intent consulta_producto · máx 1440 min",
    );
    expect(
      presentacionDe(
        nodo({ condicionTwin: { arbol: {} }, timeout: 2, unidadTimeout: "dias" }),
        CATALOGOS,
      ).resumen,
    ).toBe("Vuelve cuando se cumple la condición del Twin · máx 2 días");
    expect(presentacionDe(nodo({}), CATALOGOS).resumen).toBe(
      "Falta elegir cuándo vuelve · máx 1440 min",
    );
  });
});

describe("progresoDeDelegacion", () => {
  it("mientras espera: el turno y qué espera", () => {
    expect(
      progresoDeDelegacion(
        { esperando: "turno_agente", turnos: 3, esperando_intent: "i-cot" },
        CATALOGOS,
      ),
    ).toBe("turno 3 · esperando intent consulta_producto");
    expect(
      progresoDeDelegacion(
        { esperando: "turno_agente", turnos: 0, esperando_twin: true },
        CATALOGOS,
      ),
    ).toBe("sin turnos todavía · esperando la condición del Twin");
  });

  it("al volver: por qué salida y por qué", () => {
    expect(
      progresoDeDelegacion(
        { vuelve_por: "resuelto", motivo: "intent", turnos: 2, costo_usd: 0.0123 },
        CATALOGOS,
      ),
    ).toBe("volvió por Resuelto · se detectó el intent · 2 turnos · USD 0,0123");
    expect(
      progresoDeDelegacion(
        { vuelve_por: "sin_respuesta", motivo: "vencio", turnos: 1, costo_usd: 0 },
        CATALOGOS,
      ),
    ).toBe("volvió por Sin respuesta · venció el tiempo máximo · 1 turno · USD 0");
  });

  it("otra salida de paso no es un progreso", () => {
    expect(progresoDeDelegacion({ mensaje_id: "m1" }, CATALOGOS)).toBeNull();
    expect(progresoDeDelegacion(null, CATALOGOS)).toBeNull();
  });
});
