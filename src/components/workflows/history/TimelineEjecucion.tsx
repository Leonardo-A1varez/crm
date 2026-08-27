"use client";

import { PasoHistorial } from "./PasoHistorial";
import type { PasoEjecutado } from "./types";

interface TimelineEjecucionProps {
  pasos: PasoEjecutado[];
  nodoActual?: string | null;
}

/**
 * Timeline visual vertical con lineas conectoras entre pasos.
 */
export function TimelineEjecucion({ pasos, nodoActual }: TimelineEjecucionProps) {
  if (pasos.length === 0) {
    return (
      <p className="text-ink-faint py-4 text-center text-[12px] italic">
        Todavia no hay pasos ejecutados.
      </p>
    );
  }

  // Marcar el paso actual como running si coincide
  const pasosConEstado = pasos.map((p) => ({
    ...p,
    estado: p.nodo_id === nodoActual && p.estado === "pending" ? "running" : p.estado,
  })) as PasoEjecutado[];

  return (
    <div className="flex flex-col">
      {pasosConEstado.map((paso, idx) => (
        <PasoHistorial key={paso.id} paso={paso} isLast={idx === pasosConEstado.length - 1} />
      ))}
    </div>
  );
}
