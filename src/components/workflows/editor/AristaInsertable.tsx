"use client";

import { memo, useRef, type DragEvent } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { cn } from "@/lib/utils";
import { CURVA, DURACION } from "./tokens-editor";

/**
 * Lo que una arista de este editor lleva en `data`.
 *
 * `previsualizacion` es el idioma visual de dos gestos que hoy son invisibles
 * en toda herramienta del mercado:
 *
 *  - `cosida` — la línea que va a quedar si borrás el nodo del medio. Se
 *    dibuja punteada y verde mientras el mouse está sobre el botón de borrar,
 *    **antes** de borrar nada. Es la respuesta anticipada a "¿y qué pasa con
 *    lo que venía después?".
 *  - `cortada` — las dos líneas que desaparecen en ese mismo gesto, en rojo
 *    tenue. Se ven juntas con la cosida: una imagen, no un párrafo.
 */
export interface DatosArista extends Record<string, unknown> {
  /** Etiqueta del puerto de origen: "Sí", "No", "sin stock". */
  puerto?: string;
  previsualizacion?: "cosida" | "cortada";
}

export type AristaEditor = Edge<DatosArista>;

/**
 * Arista con zona de inserción.
 *
 * **El gesto:** soltar un bloque sobre una línea lo inserta ahí, entre los dos
 * nodos que la línea une. El gesto sólo existe si se ve, así que la línea
 * lleva un objetivo real —un chip de 24 px en el medio— y no un `drop` mudo
 * sobre el trazo.
 *
 * ## Por qué el objetivo es HTML y no el path del SVG
 *
 * Un `<path>` de SVG se puede hacer clickeable con un trazo invisible ancho,
 * pero durante un arrastre nativo de HTML5 el `:hover` de CSS no se aplica de
 * forma confiable. El chip vive en `EdgeLabelRenderer`, que es una capa HTML
 * encima del lienzo: recibe `dragover`/`drop` como cualquier div, tiene un
 * área de toque real y es alcanzable con teclado.
 *
 * ## El presupuesto de 80 nodos
 *
 * El resaltado de "estás por soltar acá" **no pasa por estado de React**. El
 * handler escribe `dataset.activo` sobre el propio nodo del DOM y CSS hace el
 * resto. Guardar "sobre qué arista está el cursor" en un `useState` del lienzo
 * repinta el grafo entero en cada `dragover`, que dispara ~60 veces por
 * segundo: es exactamente la clase de bucle que hace que n8n se arrastre
 * pasados los 50 nodos.
 */
export const AristaInsertable = memo(function AristaInsertable({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
}: EdgeProps<AristaEditor>) {
  const chipRef = useRef<HTMLDivElement>(null);

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
  });

  const previsualizacion = data?.previsualizacion;

  function marcar(activo: boolean) {
    const el = chipRef.current;
    if (!el) return;
    if (activo) el.dataset.activo = "";
    else delete el.dataset.activo;
  }

  function alSoltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    marcar(false);
    const tipo = e.dataTransfer.getData("application/reactflow");
    if (!tipo) return;
    // El lienzo escucha este evento en su raíz. Va por evento del DOM y no por
    // callback en `data` porque `data` viaja en cada arista: meter una función
    // ahí rompería la referencia estable y con ella el memo de las aristas.
    emitirInsercion(e.currentTarget, { aristaId: id, tipo });
  }

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        interactionWidth={24}
        style={style}
        className={cn(
          "!stroke-[1.6]",
          previsualizacion === "cosida" && "!stroke-ok [stroke-dasharray:5_4]",
          previsualizacion === "cortada" && "!stroke-danger/50 [stroke-dasharray:3_5]",
          !previsualizacion && "!stroke-line-control",
        )}
      />

      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="pointer-events-none absolute flex flex-col items-center gap-1"
        >
          {data?.puerto ? (
            <span className="border-line-card bg-surface-elevated text-ink-faint rounded px-1.5 py-0.5 font-mono text-[9.5px] leading-tight font-semibold">
              {data.puerto}
            </span>
          ) : null}

          <div
            ref={chipRef}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              marcar(true);
            }}
            onDragLeave={() => marcar(false)}
            onDrop={alSoltar}
            title="Soltá un bloque acá para insertarlo entre estos dos pasos"
            className={cn(
              // `nodrag`/`nopan` son de React Flow: sin ellas el lienzo se
              // desplaza cuando arrastrás sobre el chip.
              "nodrag nopan pointer-events-auto grid size-6 place-items-center rounded-full border",
              "border-line-control bg-surface-elevated text-ink-ghost",
              // Invisible en reposo, visible cuando el lienzo está en modo
              // arrastre. La clase la enciende el contenedor del lienzo con un
              // atributo, no un estado por arista.
              "opacity-0 group-data-[arrastrando]/lienzo:opacity-100",
              "focus-within:opacity-100 hover:opacity-100",
              // Estado de "vas a soltar acá": crece y se tiñe de marca.
              "data-[activo]:border-brand data-[activo]:text-brand data-[activo]:scale-125 data-[activo]:opacity-100",
              "transition-[opacity,transform,border-color,color]",
              DURACION.FLOTANTE,
              CURVA.SALIDA,
              "motion-reduce:transition-none motion-reduce:data-[activo]:scale-100",
            )}
          >
            <span aria-hidden className="text-[13px] leading-none font-medium">
              +
            </span>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

/** Nombre del evento que sube desde una arista cuando le sueltan un bloque encima. */
export const EVENTO_INSERTAR_EN_ARISTA = "workflow:insertar-en-arista";

export interface DetalleInsercion {
  aristaId: string;
  tipo: string;
}

/**
 * Emite el evento de inserción. Burbujea hasta la raíz del lienzo, que es
 * quien sabe modificar el grafo. La arista no conoce el grafo y no debería:
 * si le pasáramos un callback por `data`, cada arista tendría una prop nueva
 * en cada render del padre y se caería el memo de todas.
 */
function emitirInsercion(nodo: HTMLElement, detalle: DetalleInsercion) {
  nodo.dispatchEvent(
    new CustomEvent<DetalleInsercion>(EVENTO_INSERTAR_EN_ARISTA, {
      detail: detalle,
      bubbles: true,
    }),
  );
}
