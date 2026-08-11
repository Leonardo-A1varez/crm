"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * El chip de la barra de filtros de `/leads`.
 *
 * Las clases viven acá y no en cada componente porque las comparten dos formas
 * del mismo control: el chip que enciende una opción cerrada (una etapa, un
 * canal) y el disparador de las mini-pantallas de lista variable. Los dos son
 * "un filtro de la barra" y tienen que verse iguales.
 */
export const CHIP_BASE =
  "inline-flex shrink-0 items-center gap-1.5 rounded-[20px] border px-[10px] py-[4.5px] text-[11.5px] font-[550] transition-colors";
export const CHIP_ON = "bg-surface-avatar border-line-control text-ink-primary";
export const CHIP_OFF = "border-line-card text-ink-dim bg-transparent hover:text-ink-secondary";

export function ChipFiltro({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(CHIP_BASE, activo ? CHIP_ON : CHIP_OFF)}
    >
      {children}
    </button>
  );
}
