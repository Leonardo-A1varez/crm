"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface NodoDraggableProps {
  tipo: string;
  /** Ya resaltado (con `<mark>`) cuando viene de un resultado de búsqueda. */
  nombre: ReactNode;
  descripcion: string;
  icono: LucideIcon;
  /** Nombre de la categoría, mostrado solo en la lista plana de búsqueda. */
  categoria?: string;
  onDragStart: (tipo: string) => void;
}

/** Un nodo de la paleta: arrastrable al canvas, con tooltip de descripción. */
export function NodoDraggable({
  tipo,
  nombre,
  descripcion,
  icono: Icono,
  categoria,
  onDragStart,
}: NodoDraggableProps) {
  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData("application/reactflow", tipo);
    event.dataTransfer.effectAllowed = "move";
    onDragStart(tipo);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      title={descripcion}
      data-tipo={tipo}
      className="text-ink-secondary hover:bg-surface-hover flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors active:cursor-grabbing"
    >
      <Icono className="text-ink-muted size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{nombre}</span>
      {categoria ? (
        <span className="text-ink-faint shrink-0 truncate text-[10px]">{categoria}</span>
      ) : null}
    </div>
  );
}
