"use client";

import type { ProblemaGrafo } from "@/types/workflows";

interface CanvasToolbarProps {
  problemas: ProblemaGrafo[];
  guardando: boolean;
  puedeGuardar: boolean;
  onGuardar: () => void;
}

export function CanvasToolbar({
  problemas,
  guardando,
  puedeGuardar,
  onGuardar,
}: CanvasToolbarProps) {
  const sano = problemas.length === 0;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        {sano ? (
          <span className="text-[12px] text-emerald-600 dark:text-emerald-400">
            ✓ El flujo está sano
          </span>
        ) : (
          <span className="text-[12px] text-amber-600 dark:text-amber-400">
            ⚠ {problemas.length} problema{problemas.length > 1 ? "s" : ""} por resolver
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onGuardar}
        disabled={guardando || !puedeGuardar || !sano}
        className="rounded-md bg-emerald-600 px-4 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {guardando ? "Guardando…" : "Guardar versión"}
      </button>
    </div>
  );
}
