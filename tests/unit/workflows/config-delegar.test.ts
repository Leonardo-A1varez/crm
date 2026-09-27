import { describe, expect, it } from "vitest";
import {
  configDeAccion,
  editorDeConfig,
  MAX_INSTRUCCIONES_TRAMO,
  revisarConfig,
} from "@/lib/workflows/config-nodos";
import { ACCION_DE_TIPO, ACCIONES } from "@/lib/workflows/catalogo";
import type { Grupo } from "@/lib/ui/condiciones";

/**
 * El contrato de la config de "Delegar al agente" (PRD §4.5, difusión §9.6):
 * instrucciones extra, cuándo vuelve, tiempo máximo obligatorio y los topes.
 */

const nodo = (config: Record<string, unknown>) => ({
  id: "d",
  tipo: "ia_delegar" as const,
  config,
});

const ARBOL_COMPLETO: Grupo = {
  id: "g",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r",
      clase: "regla",
      campoId: "lead.etapa",
      comparador: "es",
      valor: { tipo: "opcion", valor: "cotizado" },
    },
  ],
};

describe("config de Delegar al agente", () => {
  it("es una acción del registro", () => {
    expect(ACCIONES).toContain("delegar_al_agente");
    expect(ACCION_DE_TIPO.ia_delegar).toBe("delegar_al_agente");
  });

  it("vale con un intent de vuelta y los defaults del PRD", () => {
    const c = configDeAccion("delegar_al_agente", nodo({ intentId: "i1" }));
    expect(c).toMatchObject({
      intentId: "i1",
      timeout: 1440,
      unidadTimeout: "minutos",
      maxTurnos: 20,
      maxCostoUsd: 0.5,
    });
  });

  it("el panel muestra el tiempo máximo de 1440 minutos sin que nadie lo escriba", () => {
    const e = editorDeConfig("ia_delegar", {});
    expect(e.valores.timeout).toBe(1440);
    expect(e.valores.unidadTimeout).toBe("minutos");
  });

  it("no se publica sin tiempo máximo", () => {
    for (const timeout of [0, -5, null, "1440"]) {
      expect(revisarConfig(nodo({ intentId: "i1", timeout }))?.errores).toEqual([
        "El tiempo máximo es obligatorio: ningún tramo delegado queda sin destino final",
      ]);
    }
  });

  it("no se publica sin decir cuándo vuelve", () => {
    expect(revisarConfig(nodo({}))?.errores).toEqual([
      "Elegí cuándo vuelve el flujo: un intent o una condición del Twin",
    ]);
    expect(revisarConfig(nodo({ intentId: "  " }))?.errores).toHaveLength(1);
  });

  it("vuelve con una condición del Twin completa", () => {
    expect(revisarConfig(nodo({ condicionTwin: { arbol: ARBOL_COMPLETO } }))?.errores).toEqual([]);
  });

  it("una condición del Twin a medias no se publica", () => {
    const aMedias = {
      ...ARBOL_COMPLETO,
      hijos: [
        { clase: "regla", id: "r", campoId: null, comparador: null, valor: { tipo: "ninguno" } },
      ],
    };
    expect(revisarConfig(nodo({ condicionTwin: { arbol: aMedias } }))?.errores.length).toBe(1);
  });

  it("el tiempo máximo no pasa de 7 días", () => {
    expect(
      revisarConfig(nodo({ intentId: "i1", timeout: 8, unidadTimeout: "dias" }))?.errores,
    ).toEqual(["El tiempo máximo no puede pasar de 7 días"]);
    expect(
      revisarConfig(nodo({ intentId: "i1", timeout: 7, unidadTimeout: "dias" }))?.errores,
    ).toEqual([]);
  });

  it("los topes de turnos y costo tienen rango", () => {
    expect(revisarConfig(nodo({ intentId: "i1", maxTurnos: 0 }))?.errores).toHaveLength(1);
    expect(revisarConfig(nodo({ intentId: "i1", maxTurnos: 51 }))?.errores).toHaveLength(1);
    expect(revisarConfig(nodo({ intentId: "i1", maxCostoUsd: 0 }))?.errores).toHaveLength(1);
    expect(revisarConfig(nodo({ intentId: "i1", maxCostoUsd: 21 }))?.errores).toHaveLength(1);
  });

  it("las instrucciones tienen tope", () => {
    expect(
      revisarConfig(
        nodo({ intentId: "i1", instrucciones: "x".repeat(MAX_INSTRUCCIONES_TRAMO + 1) }),
      )?.errores,
    ).toEqual([`Las instrucciones no pueden pasar de ${MAX_INSTRUCCIONES_TRAMO} caracteres`]);
  });
});
