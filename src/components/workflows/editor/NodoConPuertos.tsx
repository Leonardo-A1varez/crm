"use client";

import { memo, type ReactNode } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { CURVA, DURACION, FOCO } from "./tokens-editor";
import { MarcaSeveridad } from "./Validacion";
import { estadoNodoDeSeveridad, type ProblemaNodo } from "./severidad";
import { NodoBase } from "./contrato-nodos";
import type { CategoriaVisual, EstadoNodo, IconoNodo, SalidaNodo } from "./contrato-nodos";

/**
 * Lo que un nodo del editor lleva en `data`.
 *
 * **Todo esto debe construirse una sola vez por nodo, memoizado en el
 * contenedor.** React Flow pasa `data` por identidad a un componente
 * memoizado: recalcular el objeto en cada render del lienzo hace que los 80
 * nodos se repinten en cada movimiento del viewport. Es la diferencia entre
 * 60 fps y 12, y es exactamente el punto donde n8n se cae pasados los ~50.
 */
export interface DatosNodoEditor extends Record<string, unknown> {
  nombre: string;
  categoria: CategoriaVisual;
  icono?: IconoNodo;
  /**
   * Resumen de la config en prosa, con los valores envueltos en `<Dato>`.
   * Nunca JSON, nunca el objeto crudo: el vendedor lee "Canal WhatsApp ·
   * intercepta el LLM", no `{"canal":"whatsapp"}`.
   */
  resumen?: ReactNode;
  /**
   * Estado de ejecución. Si se omite, se deriva de `problemas`.
   *
   * Se acepta explícito porque las pantallas de corrida lo saben del backend
   * (`ejecutando`, `memoizado`) y ahí no hay problemas de validación que
   * derivar.
   */
  estado?: EstadoNodo;
  /** Hora para `memoizado` ("14:32"), duración para `ejecutando` ("36s"). */
  datoEstado?: string;
  /**
   * Problemas del nodo. Pintan la marca de severidad y, si no se pasó
   * `estado`, también el borde de la tarjeta.
   *
   * **Debe ser una referencia estable.** Un `[]` literal en el JSX del padre
   * crea un array nuevo en cada render y anula el memo de los 80 nodos.
   * Para el caso vacío se exporta `SIN_PROBLEMAS`.
   */
  problemas?: readonly ProblemaNodo[];
  /** Salidas del nodo. Vacío = terminal, sin conector abajo. */
  salidas?: SalidaNodo[];
  /** Los disparadores son los únicos sin entrada: nada los precede. */
  sinEntrada?: boolean;
  /** `false` en el diff y en la corrida, que son de sólo lectura. */
  borrable?: boolean;
}

export type NodoEditor = Node<DatosNodoEditor>;

/** Referencia compartida para el caso "este nodo no tiene problemas". Ver `problemas`. */
export const SIN_PROBLEMAS: readonly ProblemaNodo[] = [];

/** Evento que emite el botón de borrar al recibir el mouse encima o el foco. */
export const EVENTO_PREVISUALIZAR_BORRADO = "workflow:previsualizar-borrado";
/** Evento que emite el botón de borrar al hacer clic. */
export const EVENTO_BORRAR_NODO = "workflow:borrar-nodo";

export interface DetalleBorrado {
  /** `null` en previsualizar significa "salí de encima, apagá la previsualización". */
  nodoId: string | null;
}

/**
 * Los gestos del nodo suben por evento del DOM y no por callback en `data`.
 *
 * Un callback en `data` cambia de identidad en cada render del contenedor, y
 * con él cambia `data`, y con `data` se cae el memo de **todos** los nodos.
 * Un `CustomEvent` que burbujea hasta la raíz del lienzo cuesta lo mismo y no
 * toca ninguna referencia.
 */
function emitir(el: HTMLElement, tipo: string, detalle: DetalleBorrado) {
  el.dispatchEvent(new CustomEvent<DetalleBorrado>(tipo, { detail: detalle, bubbles: true }));
}

/**
 * Un nodo del lienzo del editor.
 *
 * Es una envoltura fina sobre `NodoBase`, que es quien dibuja la tarjeta y los
 * conectores. Acá sólo se agregan las dos afordancias que son del editor y no
 * del nodo:
 *
 * ## 1. La marca de severidad
 *
 * `NodoBase` pinta un estado por vez y eso está bien para la corrida, donde un
 * nodo está en un estado y nada más. En el editor un nodo puede estar roto,
 * apuntar a una etiqueta borrada y encima no estar publicado, las tres cosas a
 * la vez. La marca es un punto por severidad activa, arriba a la izquierda —
 * enfrente de la etiqueta de estado, que va a la derecha, para que no se pisen.
 *
 * ## 2. El botón de borrar, que muestra la costura antes de coser
 *
 * Al recibir el mouse encima —**antes del clic**— emite un evento y el lienzo
 * pinta en verde punteado la línea que va a quedar y en rojo tenue las dos que
 * se van. Borrar un nodo del medio cose la línea; que eso se vea antes de que
 * sea irreversible es la diferencia entre confiar en la herramienta y tener que
 * deshacer para entender qué hizo.
 */
export const NodoConPuertos = memo(function NodoConPuertos({
  id,
  data,
  selected,
}: NodeProps<NodoEditor>) {
  const problemas = data.problemas ?? SIN_PROBLEMAS;
  const estado = data.estado ?? estadoNodoDeSeveridad(problemas);

  return (
    <div className="group/nodo relative">
      <NodoBase
        nombre={data.nombre}
        categoria={data.categoria}
        icono={data.icono}
        selected={selected}
        estado={estado}
        datoEstado={data.datoEstado}
        tieneEntrada={!data.sinEntrada}
        tieneSalida={data.salidas === undefined}
        salidas={data.salidas}
      >
        {data.resumen}
      </NodoBase>

      <MarcaSeveridad problemas={problemas} className="absolute -top-2 -left-2 shadow-sm" />

      {data.borrable ? (
        <button
          type="button"
          aria-label={`Borrar ${data.nombre}. La línea se cose sola.`}
          onMouseEnter={(e) =>
            emitir(e.currentTarget, EVENTO_PREVISUALIZAR_BORRADO, { nodoId: id })
          }
          onFocus={(e) => emitir(e.currentTarget, EVENTO_PREVISUALIZAR_BORRADO, { nodoId: id })}
          onMouseLeave={(e) =>
            emitir(e.currentTarget, EVENTO_PREVISUALIZAR_BORRADO, { nodoId: null })
          }
          onBlur={(e) => emitir(e.currentTarget, EVENTO_PREVISUALIZAR_BORRADO, { nodoId: null })}
          onClick={(e) => {
            e.stopPropagation();
            emitir(e.currentTarget, EVENTO_BORRAR_NODO, { nodoId: id });
          }}
          className={cn(
            // `nodrag` es de React Flow: sin ella, apretar el botón arrastra el nodo.
            "nodrag border-line-control bg-surface-elevated text-ink-ghost absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border shadow-sm",
            "hover:border-danger hover:text-danger",
            // Sólo visible con el mouse encima del nodo o con foco de teclado.
            // Ochenta botones × flotando serían una interfaz ilegible; además,
            // aparecer al acercarse es lo que enseña que el gesto existe.
            "opacity-0 group-hover/nodo:opacity-100 focus-visible:opacity-100",
            "transition-[opacity,border-color,color]",
            DURACION.PRESION,
            CURVA.SALIDA,
            "motion-reduce:transition-none",
            FOCO,
          )}
        >
          <span aria-hidden className="text-[13px] leading-none">
            ×
          </span>
        </button>
      ) : null}
    </div>
  );
});

/**
 * Mapa de tipos de nodo para React Flow.
 *
 * Un solo tipo para los 57: la diferencia entre un `msg_texto` y un
 * `ia_clasificar` está entera en `data` (nombre, categoría, ícono, resumen), no
 * en el componente. 57 componentes que se diferencian en tres strings serían 57
 * lugares donde arreglar el mismo bug.
 *
 * Se declara a nivel de módulo, no dentro del componente: pasarle a `ReactFlow`
 * un objeto `nodeTypes` nuevo en cada render desmonta y vuelve a montar todos
 * los nodos: el error de rendimiento más caro que se puede cometer con esta
 * librería.
 */
export const TIPOS_NODO_EDITOR = { editor: NodoConPuertos } as const;
