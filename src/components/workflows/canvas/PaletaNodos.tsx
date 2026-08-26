"use client";

import { ETIQUETA_NODO } from "@/lib/workflows/catalogo";
import { NODO_TIPOS, type NodoTipo } from "@/types/workflows";

const COLORES: Record<NodoTipo, string> = {
  disparador: "bg-emerald-500",
  accion: "bg-blue-500",
  condicion: "bg-amber-500",
  espera: "bg-gray-500",
  fin: "bg-red-500",
};

interface PaletaNodosProps {
  onDragStart: (tipo: NodoTipo) => void;
}

export function PaletaNodos({ onDragStart }: PaletaNodosProps) {
  const handleDragStart = (event: React.DragEvent, tipo: NodoTipo) => {
    event.dataTransfer.setData("application/reactflow", tipo);
    event.dataTransfer.effectAllowed = "move";
    onDragStart(tipo);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {NODO_TIPOS.map((tipo) => (
        <div
          key={tipo}
          draggable
          onDragStart={(e) => handleDragStart(e, tipo)}
          className={`cursor-grab rounded-md px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-transform hover:scale-105 active:cursor-grabbing ${COLORES[tipo]}`}
        >
          + {ETIQUETA_NODO[tipo]}
        </div>
      ))}
    </div>
  );
}
