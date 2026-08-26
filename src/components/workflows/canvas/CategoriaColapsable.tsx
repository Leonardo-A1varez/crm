"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface CategoriaColapsableProps {
  nombre: string;
  color: string;
  cantidad: number;
  abierta: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * Header clickeable + panel animado por altura (técnica `grid-template-rows`
 * 0fr/1fr: anima sin medir el alto real del contenido en JS).
 */
export function CategoriaColapsable({
  nombre,
  color,
  cantidad,
  abierta,
  onToggle,
  children,
}: CategoriaColapsableProps) {
  return (
    <div className="border-line-layout border-b last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierta}
        className="hover:bg-surface-hover flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
      >
        <ChevronRight
          className={`text-ink-faint size-3.5 shrink-0 transition-transform duration-200 ${
            abierta ? "rotate-90" : ""
          }`}
          aria-hidden
        />
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-ink-primary flex-1 truncate text-xs font-semibold">{nombre}</span>
        <span className="text-ink-faint bg-surface-hover shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums">
          {cantidad}
        </span>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          abierta ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
