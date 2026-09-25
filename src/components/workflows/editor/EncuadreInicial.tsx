"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  getViewportForBounds,
  useReactFlow,
  useStore,
  useStoreApi,
  type InternalNode,
  type Viewport,
} from "@xyflow/react";

import { MEDIDAS } from "./tokens-editor";

/**
 * Cómo encuadran los tres lienzos —editor, diff y corrida— al abrir y cuando
 * alguien aprieta "Encuadrar todo el flujo".
 *
 * **Por qué no alcanza con la prop `fitView` de React Flow.** Los tres lienzos
 * usan `onlyRenderVisibleElements`, y en la versión instalada el encuadre
 * automático sólo cuenta los nodos que ya tienen medida (`getFitViewNodes` de
 * `@xyflow/system` descarta los que no tienen `measured.width/height`). Al
 * abrir, el viewport arranca en `(0, 0)` a zoom 1: los nodos que caen fuera de
 * esa ventana nunca se montan, nunca se miden, y el "encuadre" se hacía sobre
 * los que ya estaban a la vista. El flujo abría cortado.
 *
 * Además la prop deja el encuadre **pendiente** mientras no haya nodos: en un
 * flujo vacío, el primer bloque que alguien soltaba disparaba el encuadre y la
 * cámara saltaba sola hacia ese bloque, con la vista ya movida por la persona.
 *
 * Acá los límites se calculan con todos los nodos: la medida real si ya la
 * tienen, y si no el ancho fijo del nodo y el alto de su encabezado. Esa
 * estimación queda corta en alto para los nodos con resumen, y el margen del
 * encuadre es lo que la cubre: `padding: 0.2` deja por lado
 * `(lado - lado / 1.2) / 2` del lienzo (`parsePadding` de `@xyflow/system`).
 */
export const ENCUADRE_TODO = { padding: 0.2, maxZoom: 1 } as const;

type NodoMedible = Pick<InternalNode, "hidden" | "measured" | "width" | "height" | "internals">;

/**
 * El viewport que muestra todos los nodos visibles con margen, o `null` si no
 * hay nada que encuadrar (flujo vacío o lienzo todavía sin tamaño). `null`
 * significa "no mover la cámara": un flujo vacío se queda en zoom 1.
 */
export function viewportParaEncuadrar(
  nodos: Iterable<NodoMedible>,
  ancho: number,
  alto: number,
  minZoom: number,
): Viewport | null {
  if (ancho <= 0 || alto <= 0) return null;

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodos) {
    if (n.hidden) continue;
    const { x, y } = n.internals.positionAbsolute;
    const w = n.measured.width ?? n.width ?? MEDIDAS.NODO_ANCHO;
    const h = n.measured.height ?? n.height ?? MEDIDAS.NODO_HEADER;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  }
  if (!Number.isFinite(x0)) return null;

  return getViewportForBounds(
    { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    ancho,
    alto,
    minZoom,
    ENCUADRE_TODO.maxZoom,
    ENCUADRE_TODO.padding,
  );
}

/**
 * Mueve la cámara para mostrar el flujo entero. Devuelve `false` si no movió
 * nada. Tiene que llamarse debajo del mismo `ReactFlowProvider` que el lienzo.
 */
export function useEncuadrarTodo(): (opciones?: { duration?: number }) => boolean {
  const store = useStoreApi();
  const { setViewport } = useReactFlow();

  return useCallback(
    (opciones?: { duration?: number }) => {
      const { nodeLookup, width, height, minZoom } = store.getState();
      const viewport = viewportParaEncuadrar(nodeLookup.values(), width, height, minZoom);
      if (viewport === null) return false;
      void setViewport(viewport, { duration: opciones?.duration ?? 0 });
      return true;
    },
    [store, setViewport],
  );
}

/**
 * Encuadra **una sola vez**, cuando el lienzo ya tiene tamaño. Va como hijo de
 * `<ReactFlow>`: así corre después de que React Flow cargó los nodos y armó el
 * zoom.
 *
 * Después no vuelve a tocar la cámara. Si el flujo abrió vacío tampoco: el
 * primer bloque que se suelte no mueve la vista que la persona ya eligió.
 */
export function EncuadreInicial() {
  const encuadrar = useEncuadrarTodo();
  const listo = useStore((s) => s.width > 0 && s.height > 0 && s.panZoom !== null);
  const hecho = useRef(false);

  useEffect(() => {
    if (!listo || hecho.current) return;
    hecho.current = true;
    encuadrar();
  }, [listo, encuadrar]);

  return null;
}
