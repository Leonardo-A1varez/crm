import { describe, expect, it } from "vitest";
import {
  ENCUADRE_TODO,
  viewportParaEncuadrar,
} from "@/components/workflows/editor/EncuadreInicial";
import { MEDIDAS } from "@/components/workflows/editor/tokens-editor";

/**
 * El encuadre al abrir un lienzo.
 *
 * El bug: con `onlyRenderVisibleElements`, los nodos fuera de la ventana
 * inicial nunca se miden, y el `fitView` de React Flow los descarta. El flujo
 * abría mostrando sólo lo que ya caía en `(0, 0)`. Estos tests fijan que un
 * nodo sin medir cuenta igual.
 */

function nodo(
  x: number,
  y: number,
  medida: { width?: number; height?: number } = {},
  hidden = false,
) {
  return {
    hidden,
    measured: medida,
    width: undefined,
    height: undefined,
    internals: {
      positionAbsolute: { x, y },
      z: 0,
      userNode: {} as never,
    },
  };
}

/** Qué rectángulo del flujo queda a la vista con ese viewport. */
function visible(vp: { x: number; y: number; zoom: number }, ancho: number, alto: number) {
  return {
    x0: -vp.x / vp.zoom,
    y0: -vp.y / vp.zoom,
    x1: (ancho - vp.x) / vp.zoom,
    y1: (alto - vp.y) / vp.zoom,
  };
}

describe("viewportParaEncuadrar", () => {
  it("un flujo vacío no mueve la cámara", () => {
    expect(viewportParaEncuadrar([], 1000, 600, 0.3)).toBeNull();
  });

  it("un lienzo sin tamaño todavía no encuadra", () => {
    expect(viewportParaEncuadrar([nodo(0, 0)], 0, 0, 0.3)).toBeNull();
  });

  it("incluye los nodos que nunca se midieron, con el tamaño fijo del nodo", () => {
    // El primero se midió; el segundo quedó lejos, fuera de la ventana inicial.
    const nodos = [nodo(0, 0, { width: 200, height: 60 }), nodo(1200, 1600)];
    const vp = viewportParaEncuadrar(nodos, 1000, 600, 0.3);
    expect(vp).not.toBeNull();

    const v = visible(vp!, 1000, 600);
    expect(v.x0).toBeLessThanOrEqual(0);
    expect(v.y0).toBeLessThanOrEqual(0);
    expect(v.x1).toBeGreaterThanOrEqual(1200 + MEDIDAS.NODO_ANCHO);
    expect(v.y1).toBeGreaterThanOrEqual(1600 + MEDIDAS.NODO_HEADER);
  });

  it("deja margen alrededor del flujo", () => {
    const vp = viewportParaEncuadrar([nodo(0, 0), nodo(2000, 1200)], 1000, 600, 0.1);
    const v = visible(vp!, 1000, 600);
    expect(v.x0).toBeLessThan(0);
    expect(v.x1).toBeGreaterThan(2000 + MEDIDAS.NODO_ANCHO);
  });

  it("un solo nodo no se agranda más allá del zoom 1", () => {
    const vp = viewportParaEncuadrar([nodo(40, 40, { width: 200, height: 60 })], 1200, 800, 0.3);
    expect(vp!.zoom).toBe(ENCUADRE_TODO.maxZoom);
  });

  it("ignora los nodos ocultos", () => {
    const conOculto = viewportParaEncuadrar(
      [nodo(0, 0, { width: 200, height: 60 }), nodo(5000, 5000, {}, true)],
      1200,
      800,
      0.1,
    );
    const sin = viewportParaEncuadrar([nodo(0, 0, { width: 200, height: 60 })], 1200, 800, 0.1);
    expect(conOculto).toEqual(sin);
  });
});
