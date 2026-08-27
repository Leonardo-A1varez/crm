"use client";

import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CategoriaVisual } from "@/types/workflows";

/**
 * Estilos por categoría según el design system.
 * Mapea cada categoría a sus clases de Tailwind para bg, border, header y texto.
 */
export const ESTILOS_CATEGORIA: Record<
  CategoriaVisual,
  {
    bg: string;
    border: string;
    header: string;
    text: string;
    darkBg: string;
    darkBorder: string;
    darkHeader: string;
  }
> = {
  trigger: {
    bg: "bg-emerald-50",
    border: "border-emerald-300",
    header: "bg-emerald-500",
    text: "text-emerald-800",
    darkBg: "dark:bg-emerald-950",
    darkBorder: "dark:border-emerald-700",
    darkHeader: "dark:bg-emerald-600",
  },
  mensajeria: {
    bg: "bg-blue-50",
    border: "border-blue-300",
    header: "bg-blue-500",
    text: "text-blue-800",
    darkBg: "dark:bg-blue-950",
    darkBorder: "dark:border-blue-700",
    darkHeader: "dark:bg-blue-600",
  },
  crm: {
    bg: "bg-violet-50",
    border: "border-violet-300",
    header: "bg-violet-500",
    text: "text-violet-800",
    darkBg: "dark:bg-violet-950",
    darkBorder: "dark:border-violet-700",
    darkHeader: "dark:bg-violet-600",
  },
  logica: {
    bg: "bg-amber-50",
    border: "border-amber-300",
    header: "bg-amber-500",
    text: "text-amber-800",
    darkBg: "dark:bg-amber-950",
    darkBorder: "dark:border-amber-700",
    darkHeader: "dark:bg-amber-600",
  },
  integracion: {
    bg: "bg-cyan-50",
    border: "border-cyan-300",
    header: "bg-cyan-500",
    text: "text-cyan-800",
    darkBg: "dark:bg-cyan-950",
    darkBorder: "dark:border-cyan-700",
    darkHeader: "dark:bg-cyan-600",
  },
  ia: {
    bg: "bg-pink-50",
    border: "border-pink-300",
    header: "bg-pink-500",
    text: "text-pink-800",
    darkBg: "dark:bg-pink-950",
    darkBorder: "dark:border-pink-700",
    darkHeader: "dark:bg-pink-600",
  },
  interno: {
    bg: "bg-gray-50",
    border: "border-gray-300",
    header: "bg-gray-500",
    text: "text-gray-700",
    darkBg: "dark:bg-gray-900",
    darkBorder: "dark:border-gray-600",
    darkHeader: "dark:bg-gray-600",
  },
};

/** Definición de una salida múltiple */
export interface SalidaMultiple {
  id: string;
  label: string;
  color?: string;
}

export interface NodoBaseProps {
  /** Nombre del nodo mostrado en el header */
  nombre: string;
  /** Icono de Lucide para el header */
  icono: LucideIcon;
  /** Categoría visual para colores */
  categoria: CategoriaVisual;
  /** Si el nodo está seleccionado */
  selected: boolean;
  /** Contenido del body (preview de la config) */
  children: ReactNode;
  /** Si tiene handle de entrada (false para triggers) */
  tieneEntrada?: boolean;
  /** Si tiene handle de salida simple */
  tieneSalida?: boolean;
  /** Salidas múltiples (para condición, switch, etc.) - reemplaza tieneSalida */
  salidasMultiples?: SalidaMultiple[];
  /** Estado del nodo */
  estado?: "normal" | "selected" | "error" | "running";
}

/**
 * Componente base para todos los nodos del workflow builder.
 * Implementa el design system definido en docs/design-system/workflow-nodes.md
 */
export function NodoBase({
  nombre,
  icono: Icono,
  categoria,
  selected,
  children,
  tieneEntrada = true,
  tieneSalida = true,
  salidasMultiples,
  estado = "normal",
}: NodoBaseProps) {
  const estilos = ESTILOS_CATEGORIA[categoria];
  const estadoFinal = selected ? "selected" : estado;

  return (
    <div
      className={cn(
        // Base
        "min-h-14 w-[200px] rounded-lg border",
        "shadow-sm transition-all duration-150",
        // Hover
        "hover:-translate-y-px hover:shadow-md",
        // Categoría
        estilos.bg,
        estilos.border,
        estilos.darkBg,
        estilos.darkBorder,
        // Estados
        estadoFinal === "selected" && "shadow-lg ring-2 shadow-blue-500/15 ring-blue-500",
        estadoFinal === "error" && "shadow-lg ring-2 shadow-red-500/15 ring-red-500",
        estadoFinal === "running" &&
          "animate-pulse shadow-lg ring-2 shadow-emerald-500/20 ring-emerald-500",
      )}
    >
      {/* Handle entrada */}
      {tieneEntrada && (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-2.5 !w-2.5 !border-2 !border-white !bg-gray-400 transition-all hover:!h-3.5 hover:!w-3.5 hover:!bg-blue-500"
        />
      )}

      {/* Header */}
      <div
        className={cn(
          "flex h-8 items-center gap-2 rounded-t-lg px-3",
          estilos.header,
          estilos.darkHeader,
        )}
      >
        <Icono className="h-4 w-4 shrink-0 text-white" />
        <span className="truncate text-[13px] leading-tight font-semibold tracking-tight text-white">
          {nombre}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <div
          className={cn(
            "line-clamp-2 text-[11px] leading-snug",
            estilos.text,
            "dark:text-gray-300",
          )}
        >
          {children}
        </div>
      </div>

      {/* Handle(s) salida */}
      {salidasMultiples ? (
        <>
          {salidasMultiples.map((salida, i) => (
            <Handle
              key={salida.id}
              type="source"
              id={salida.id}
              position={Position.Bottom}
              style={{ left: `${((i + 1) / (salidasMultiples.length + 1)) * 100}%` }}
              className={cn(
                "!h-2.5 !w-2.5 !border-2 !border-white transition-all",
                "hover:!h-3.5 hover:!w-3.5",
                salida.color ?? "!bg-gray-500",
              )}
            />
          ))}
          {/* Labels bajo los handles */}
          <div className="absolute right-0 -bottom-5 left-0 flex justify-around px-4">
            {salidasMultiples.map((salida, i) => (
              <span
                key={salida.id}
                className={cn(
                  "text-[9px] font-medium",
                  salida.id === "si" || salida.id === "ok"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "",
                  salida.id === "no" || salida.id === "error"
                    ? "text-red-500 dark:text-red-400"
                    : "",
                  !["si", "no", "ok", "error"].includes(salida.id) &&
                    "text-gray-500 dark:text-gray-400",
                )}
                style={{
                  position: "absolute",
                  left: `${((i + 1) / (salidasMultiples.length + 1)) * 100}%`,
                  transform: "translateX(-50%)",
                }}
              >
                {salida.label}
              </span>
            ))}
          </div>
        </>
      ) : tieneSalida ? (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-2.5 !w-2.5 !border-2 !border-white !bg-gray-500 transition-all hover:!h-3.5 hover:!w-3.5 hover:!bg-blue-500"
        />
      ) : null}
    </div>
  );
}
