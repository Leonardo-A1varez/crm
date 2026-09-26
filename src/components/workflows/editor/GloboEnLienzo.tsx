"use client";

import { ViewportPortal, useInternalNode } from "@xyflow/react";
import { GloboProblema } from "./Validacion";
import { MEDIDAS } from "./tokens-editor";
import type { ProblemaNodo } from "./severidad";

/** Aire entre el borde derecho del nodo y el globo. Múltiplo de la grilla de 16. */
const SEPARACION = 16;

/**
 * El globo de los problemas de un nodo, dibujado en el lienzo al lado del nodo.
 *
 * Vive en el `ViewportPortal` de React Flow: comparte las coordenadas de los
 * nodos, así que acompaña al nodo cuando se arrastra el lienzo o se hace zoom
 * sin que haya que recalcular nada por frame. Se abre para el nodo
 * seleccionado y sólo con sus errores: ocho globos abiertos a la vez en un
 * flujo roto serían una pared de rojo, y el conteo de la barra ya lleva de
 * uno en uno.
 *
 * `nodrag nopan nowheel` son de React Flow: sin ellas, apretar un arreglo
 * arrastraría el lienzo en lugar de aplicar el arreglo.
 */
export function GloboEnLienzo({
  nodoId,
  problemas,
}: {
  nodoId: string;
  problemas: readonly ProblemaNodo[];
}) {
  const nodo = useInternalNode(nodoId);
  const errores = problemas.filter((p) => p.severidad === "error");
  if (!nodo || errores.length === 0) return null;

  const ancho = nodo.measured.width ?? MEDIDAS.NODO_ANCHO;
  const { x, y } = nodo.internals.positionAbsolute;

  return (
    <ViewportPortal>
      <div
        aria-label="Problemas del bloque seleccionado"
        className="nodrag nopan nowheel absolute top-0 left-0 z-10 flex flex-col gap-2"
        style={{ transform: `translate(${x + ancho + SEPARACION}px, ${y}px)` }}
      >
        {errores.map((p) => (
          <GloboProblema key={`${p.regla ?? ""}-${p.mensaje}`} problema={p} variante="lienzo" />
        ))}
      </div>
    </ViewportPortal>
  );
}
