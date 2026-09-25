"use client";

import { memo, type ReactNode } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { NodoBase } from "./contrato-nodos";
import type { CategoriaVisual, EstadoNodo, IconoNodo, SalidaNodo } from "./contrato-nodos";
import type { AccionNodo, EstadoPaso } from "./corrida";

export interface DatosNodoCorrida extends Record<string, unknown> {
  nombre: string;
  categoria: CategoriaVisual;
  icono?: IconoNodo;
  resumen?: ReactNode;
  salidas?: SalidaNodo[];
  sinEntrada?: boolean;
  /** Cómo terminó este paso en la corrida real. */
  paso: EstadoPaso;
  /** Duración ("1,2s") o tiempo en curso ("36s"). Va en Geist Mono. */
  duracion?: string;
  /** Progreso del nodo activo, 0-100. Sólo lo tienen los que reportan avance. */
  progreso?: number;
  /**
   * Qué le va a pasar bajo el plan que se está previsualizando. `undefined`
   * significa que no hay ninguna previsualización activa y el nodo se dibuja
   * según su estado real.
   */
  plan?: AccionNodo;
  /** Hora del resultado guardado, cuando `plan === "reusa"`. */
  horaReuso?: string;
}

export type NodoCorridaFlow = Node<DatosNodoCorrida>;

/**
 * Traduce el estado real de un paso al estado visual del nodo.
 *
 * `completado` mapea a `normal` y el verde lo pone el anillo de acá afuera:
 * `EstadoNodo` no tiene un estado "terminó bien" y no debería tenerlo — para el
 * editor un nodo que corrió bien es un nodo normal, y el verde es información
 * de esta pantalla, no del nodo.
 */
function estadoVisual(paso: EstadoPaso): EstadoNodo {
  switch (paso) {
    case "activo":
      return "ejecutando";
    case "fallado":
      return "error";
    case "completado":
    case "saltado":
    case "pendiente":
      return "normal";
  }
}

/**
 * Un nodo del lienzo de una corrida.
 *
 * ## La memoización se ve antes de confirmar
 *
 * Cuando `plan` está definido, este nodo deja de dibujar lo que pasó y dibuja
 * **lo que va a pasar**:
 *
 *  - `reusa` → estado `memoizado`: la tarjeta se hunde, se puntea el borde y
 *    abajo aparece "Se reusa el resultado de las 14:32". El texto y la hora los
 *    arma `etiquetaEstado()` del sistema de nodos; acá sólo se le pasa la hora.
 *  - `recorre` → la tarjeta queda en color, con un chip "vuelve a correr".
 *  - `no_alcanzado` → atenuada y punteada: nunca se llegó hasta acá, y bajo
 *    ningún plan se puede prometer que se llegue.
 *
 * O sea: la diferencia entre "Reanudar desde el fallo" y "Ejecutar de nuevo
 * desde el principio" **se ve en el flujo dibujado**, apuntando cada botón,
 * sin apretar nada. Con el primero casi todo queda gris; con el segundo se
 * enciende entero. Nadie que vea las dos imágenes las confunde.
 */
export const NodoCorrida = memo(function NodoCorrida({ data }: NodeProps<NodoCorridaFlow>) {
  const { plan } = data;

  const estado: EstadoNodo = plan === "reusa" ? "memoizado" : estadoVisual(data.paso);
  const dato = plan === "reusa" ? data.horaReuso : data.duracion;

  const anillo =
    plan === "recorre"
      ? "ring-2 ring-brand"
      : plan
        ? ""
        : data.paso === "completado"
          ? "ring-1 ring-ok/50"
          : data.paso === "saltado"
            ? "ring-2 ring-special/60"
            : "";

  const atenuado = (plan === undefined && data.paso === "pendiente") || plan === "no_alcanzado";

  return (
    <div className="relative">
      <div
        className={cn(
          "rounded-lg",
          anillo,
          atenuado && "opacity-55",
          // 200 ms: es un cambio de estado de la pantalla entera al apuntar un
          // botón, no una respuesta a un clic. Más rápido se lee como un
          // parpadeo; más lento, como que la interfaz duda.
          "transition-[opacity,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
          "motion-reduce:transition-none",
        )}
      >
        <NodoBase
          nombre={data.nombre}
          categoria={data.categoria}
          icono={data.icono}
          selected={false}
          estado={estado}
          datoEstado={dato}
          tieneEntrada={!data.sinEntrada}
          tieneSalida={data.salidas === undefined}
          salidas={data.salidas}
        >
          {data.resumen}
        </NodoBase>
      </div>

      {plan === "recorre" ? (
        <span className="bg-brand text-brand-ink absolute -top-2 -right-2 rounded-full px-1.5 py-0.5 font-mono text-[9px] leading-tight font-semibold shadow-sm">
          vuelve a correr
        </span>
      ) : null}

      {plan === undefined && data.paso === "completado" && data.duracion ? (
        <span className="border-line-card bg-surface-elevated text-ok absolute -top-2 -right-2 rounded-full border px-1.5 py-0.5 font-mono text-[9px] leading-tight font-semibold tabular-nums shadow-sm">
          {data.duracion}
        </span>
      ) : null}

      {plan === undefined && data.paso === "saltado" ? (
        <span className="border-line-card bg-surface-elevated text-special absolute -top-2 -right-2 rounded-full border px-1.5 py-0.5 font-mono text-[9px] leading-tight font-semibold shadow-sm">
          salió por tope
        </span>
      ) : null}

      {plan === undefined && data.paso === "activo" && typeof data.progreso === "number" ? (
        <div className="bg-surface-input absolute inset-x-0 -bottom-0.5 h-[3px] overflow-hidden rounded-b-lg">
          <div
            className="bg-info h-full transition-[width] duration-300 ease-linear"
            style={{ width: `${Math.min(100, Math.max(0, data.progreso))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
});

export const TIPOS_NODO_CORRIDA = { corrida: NodoCorrida } as const;
