"use client";

import { useState } from "react";
import { KeyboardArrowDown } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { OrdenDeColumna } from "@/lib/ui/orden-productos";
import type { ReactNode } from "react";

/**
 * El encabezado de una columna y el panel que abre: el encabezado ENTERO es el botón.
 *
 * Es un popover de Base UI (el que agrega shadcn), no un panel hecho a mano: sale por
 * un portal, así que el `overflow` de la tabla no lo corta; se reposiciona contra el
 * borde de la ventana y sigue al encabezado si la tabla se desplaza; cierra con
 * Escape o un clic afuera, y al cerrarse devuelve el foco al encabezado, que es lo que
 * se espera de cualquier menú. El contenido solo existe mientras está abierto: cada
 * apertura arranca con un borrador nuevo copiado de la URL.
 *
 * El indicador de columna filtrada y el de orden están en el propio encabezado, sin
 * abrir nada. Ninguno es solo color: el filtro suma un punto y cambia el nombre
 * accesible; el orden suma la flecha y el número de nivel.
 */
export function FiltroColumna({
  etiqueta,
  activo,
  orden,
  derecha,
  ancho = 288,
  accion = "Filtrar y ordenar",
  children,
}: {
  /** Nombre de la columna: "Categoría". */
  etiqueta: string;
  /** La columna tiene un filtro puesto. */
  activo: boolean;
  orden: OrdenDeColumna;
  /** Columna numérica: el encabezado va contra el borde derecho, como sus celdas. */
  derecha?: boolean;
  /** Ancho del panel en px. */
  ancho?: number;
  /** Qué hace el panel, para el lector de pantalla: "Ordenar" si la columna no se filtra. */
  accion?: string;
  children: (cerrar: () => void) => ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const ordenada = orden.nivel !== null && orden.dir !== null;
  const nombre = [
    etiqueta,
    activo ? "filtro activo" : null,
    ordenada
      ? `orden ${orden.dir === "asc" ? "ascendente" : "descendente"}${orden.niveles > 1 ? `, nivel ${orden.nivel}` : ""}`
      : null,
  ]
    .filter((p): p is string => p !== null)
    .join(", ");

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger
        aria-label={`${nombre}. ${accion}`}
        className={cn(
          "focus-visible:ring-brand/60 flex size-full min-h-[34px] items-center gap-1 px-3.5 py-2 text-left font-[inherit] tracking-[inherit] uppercase outline-none focus-visible:ring-2 focus-visible:ring-inset",
          derecha && "justify-end text-right",
          activo || ordenada || abierto
            ? "text-ink-primary"
            : "text-ink-faint hover:text-ink-secondary",
        )}
      >
        <span className="truncate">{etiqueta}</span>
        {ordenada ? (
          <span aria-hidden className="text-ink-primary shrink-0 tabular-nums">
            {orden.niveles > 1 ? (
              <span className="text-[8px] leading-none">{orden.nivel}</span>
            ) : null}
            {orden.dir === "asc" ? "↑" : "↓"}
          </span>
        ) : null}
        {/* Con el orden elegido la flecha ocupa su lugar: en las columnas angostas no entran las dos. */}
        {!ordenada ? (
          <KeyboardArrowDown
            size={11}
            aria-hidden
            className={cn(
              "shrink-0 opacity-70 transition-transform duration-150 motion-reduce:transition-none",
              abierto && "rotate-180",
            )}
          />
        ) : null}
        {activo ? <span aria-hidden className="bg-brand size-[6px] shrink-0 rounded-full" /> : null}
      </PopoverTrigger>
      <PopoverContent
        align={derecha ? "end" : "start"}
        sideOffset={2}
        aria-label={`Filtrar y ordenar ${etiqueta}`}
        style={{ width: ancho }}
        className="border-line-control bg-surface-elevated max-h-[min(640px,calc(var(--available-height)-8px))] gap-0 overflow-y-auto rounded-[10px] border p-0 font-sans text-[12px] tracking-normal normal-case shadow-lg ring-0 motion-reduce:animate-none"
      >
        {children(() => setAbierto(false))}
      </PopoverContent>
    </Popover>
  );
}
