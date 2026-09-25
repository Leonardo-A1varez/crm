"use client";

import { memo, type ReactNode } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { CURVA, DURACION } from "./tokens-editor";
import { NodoBase } from "./contrato-nodos";
import type { CategoriaVisual, IconoNodo, SalidaNodo } from "./contrato-nodos";
import { CLASE_ANILLO, CLASE_TEXTO, type CambioParametro, type ClaseCambio } from "./diff";

export interface DatosNodoDiff extends Record<string, unknown> {
  nombre: string;
  categoria: CategoriaVisual;
  icono?: IconoNodo;
  resumen?: ReactNode;
  salidas?: SalidaNodo[];
  sinEntrada?: boolean;
  clase: ClaseCambio;
  /** Texto de la insignia: "nuevo", "2 cambios", "eliminado". */
  insignia: string | null;
  /** Los parámetros que cambiaron, para el globo de viejo → nuevo. */
  parametros?: readonly CambioParametro[];
}

export type NodoDiffFlow = Node<DatosNodoDiff>;

/**
 * Un nodo en el lienzo del diff.
 *
 * ## La idea entera de esta pantalla
 *
 * El diff se dibuja **sobre el propio lienzo**, en la misma disposición en la
 * que se editó. Ninguna herramienta del mercado lo hace: todas muestran dos
 * columnas de JSON, o una lista de "campo X: antes/después". Las dos formas
 * obligan a reconstruir mentalmente el flujo para entender qué cambió, y
 * reconstruir un flujo de 30 nodos a partir de una lista es imposible.
 *
 * Acá los nodos agregados llevan anillo verde, los cambiados ámbar, y **los
 * eliminados se siguen dibujando, en su posición original**, punteados y
 * hundidos. Ese último punto es el que más importa: un nodo borrado que
 * simplemente desaparece deja un hueco que nadie puede interpretar. Dibujado en
 * su lugar, con la línea cosida pasándole por al lado, la frase "se sacó la
 * espera del medio y el flujo siguió de largo" es una imagen y no un párrafo.
 *
 * ## El globo de viejo → nuevo
 *
 * Se abre al pasar el mouse o al enfocar con teclado, y es **CSS puro**
 * (`group-hover` / `group-focus-within`). Con estado de React, mover el cursor
 * por un lienzo de 80 nodos serían 80 renders del grafo por segundo.
 *
 * En la tarjeta se muestra la cuenta ("2 cambios") y no los valores: en 200 px
 * de ancho no entran dos valores más su etiqueta sin recortarlos, y un valor
 * recortado en un diff es peor que ningún valor.
 */
export const NodoDiff = memo(function NodoDiff({ data }: NodeProps<NodoDiffFlow>) {
  const { clase, insignia, parametros } = data;
  const eliminado = clase === "eliminado";

  return (
    <div className="group/diff relative">
      <div
        className={cn(
          "rounded-lg",
          CLASE_ANILLO[clase],
          // El eliminado se hunde: sigue ahí para marcar el lugar, pero no
          // compite por atención con lo que sí va a existir después de publicar.
          eliminado && "opacity-60 grayscale-[0.4]",
        )}
      >
        <NodoBase
          nombre={data.nombre}
          categoria={data.categoria}
          icono={data.icono}
          selected={false}
          estado="normal"
          tieneEntrada={!data.sinEntrada}
          tieneSalida={data.salidas === undefined}
          salidas={data.salidas}
        >
          {data.resumen}
        </NodoBase>
      </div>

      {insignia ? (
        <span
          className={cn(
            "border-line-card bg-surface-elevated absolute -top-2 -right-2 rounded-full border px-1.5 py-0.5 font-mono text-[9px] leading-tight font-semibold shadow-sm",
            CLASE_TEXTO[clase],
          )}
        >
          {insignia}
        </span>
      ) : null}

      {parametros && parametros.length > 0 ? (
        <div
          role="note"
          className={cn(
            // `ml-2` sobre un elemento absoluto es corrimiento de posición, no
            // separación entre hermanos: no hay contenedor flex del que colgar un gap.
            "border-line-card bg-surface-elevated pointer-events-none absolute top-0 left-full z-10 ml-2 w-[248px] rounded-lg border p-2.5 shadow-lg",
            "invisible opacity-0 group-focus-within/diff:visible group-focus-within/diff:opacity-100 group-hover/diff:visible group-hover/diff:opacity-100",
            "transition-opacity",
            DURACION.FLOTANTE,
            CURVA.SALIDA,
            "motion-reduce:transition-none",
          )}
        >
          <div className="flex flex-col gap-2">
            {parametros.map((p) => (
              <div key={p.etiqueta} className="flex flex-col gap-1">
                <span className="text-ink-faint text-[10px] leading-none">{p.etiqueta}</span>
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <ValorDiff valor={p.antes} tachado />
                  <span aria-hidden className="text-ink-ghost text-[10px]">
                    →
                  </span>
                  <ValorDiff valor={p.despues} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});

/**
 * Un valor del diff.
 *
 * En Geist Mono porque es un dato que se compara — es literalmente el gesto que
 * define esta pantalla. `null` se dibuja como "sin definir" en cursiva y no
 * como una cadena vacía: un hueco no dice si el campo estaba vacío o si no
 * existía.
 */
function ValorDiff({ valor, tachado = false }: { valor: string | null; tachado?: boolean }) {
  if (valor === null) {
    return <span className="text-ink-ghost text-[10.5px] italic">sin definir</span>;
  }
  return (
    <span
      className={cn("font-mono text-[10.5px]", tachado ? "text-ink-ghost line-through" : "text-ok")}
    >
      {valor}
    </span>
  );
}

/** Tipo de nodo del lienzo del diff. A nivel de módulo, como todos. */
export const TIPOS_NODO_DIFF = { diff: NodoDiff } as const;
