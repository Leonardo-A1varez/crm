"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ESTADOS_PASO } from "./estados";
import type { PasoEjecutado } from "./types";

interface PasoHistorialProps {
  paso: PasoEjecutado;
  isLast: boolean;
}

/**
 * Un paso dentro de la timeline con estado, duracion y entrada/salida colapsable.
 */
export function PasoHistorial({ paso, isLast }: PasoHistorialProps) {
  const [abierto, setAbierto] = useState(false);
  const estadoConfig = ESTADOS_PASO[paso.estado];
  const Icono = estadoConfig.icono;

  const tieneDetalles =
    paso.error ||
    (paso.entrada && Object.keys(paso.entrada).length > 0) ||
    (paso.salida && Object.keys(paso.salida).length > 0);

  return (
    <div className="flex gap-3">
      {/* Linea vertical + icono */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            estadoConfig.bg,
          )}
        >
          <Icono
            size={14}
            className={cn(estadoConfig.color, paso.estado === "running" && "animate-spin")}
          />
        </div>
        {!isLast && <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700" />}
      </div>

      {/* Contenido */}
      <div className={cn("min-w-0 flex-1", !isLast && "pb-4")}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-primary truncate text-[12px] font-medium">
            {paso.nodo_nombre}
          </span>
          <span className="text-ink-faint shrink-0 text-[11px]">
            {paso.estado === "running" ? "..." : `${paso.duracion_ms}ms`}
          </span>
        </div>

        {paso.error && (
          <div className="mt-1 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {paso.error}
          </div>
        )}

        {/* Expandible: entrada/salida */}
        {tieneDetalles && !paso.error && (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="text-ink-faint hover:text-ink-secondary mt-1 flex items-center gap-0.5 text-[11px] transition-colors"
          >
            {abierto ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Ver datos
          </button>
        )}

        {abierto && tieneDetalles && (
          <div className="mt-2 space-y-2">
            {paso.entrada && Object.keys(paso.entrada).length > 0 && (
              <div>
                <span className="text-ink-secondary text-[10px] font-medium tracking-wide uppercase">
                  Entrada
                </span>
                <pre className="bg-surface-hover mt-1 overflow-x-auto rounded-md p-2 text-[10px]">
                  {JSON.stringify(paso.entrada, null, 2)}
                </pre>
              </div>
            )}
            {paso.salida && Object.keys(paso.salida).length > 0 && (
              <div>
                <span className="text-ink-secondary text-[10px] font-medium tracking-wide uppercase">
                  Salida
                </span>
                <pre className="bg-surface-hover mt-1 overflow-x-auto rounded-md p-2 text-[10px]">
                  {JSON.stringify(paso.salida, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
