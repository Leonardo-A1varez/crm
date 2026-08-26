"use client";

import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import type { NodoTipo } from "@/types/workflows";

const COLORES = {
  emerald: "bg-emerald-500 border-emerald-600",
  blue: "bg-blue-500 border-blue-600",
  amber: "bg-amber-500 border-amber-600",
  gray: "bg-gray-500 border-gray-600",
  red: "bg-red-500 border-red-600",
} as const;

type ColorKey = keyof typeof COLORES;

interface NodoBaseProps {
  tipo: NodoTipo;
  titulo: string;
  color: ColorKey;
  selected: boolean;
  children: ReactNode;
  handles?: { entrada?: boolean; salida?: boolean; verdadero?: boolean; falso?: boolean };
}

export function NodoBase({ titulo, color, selected, children, handles = {} }: NodoBaseProps) {
  const { entrada = false, salida = false, verdadero = false, falso = false } = handles;

  return (
    <div
      className={`min-w-[180px] rounded-lg border-2 bg-white shadow-md dark:bg-gray-900 ${
        selected ? "ring-2 ring-blue-400 ring-offset-2" : ""
      }`}
    >
      {entrada && (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !border-2 !border-white !bg-gray-400"
        />
      )}

      <div
        className={`rounded-t-md px-3 py-1.5 text-[11px] font-semibold text-white ${COLORES[color]}`}
      >
        {titulo}
      </div>

      <div className="p-3">{children}</div>

      {salida && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-3 !w-3 !border-2 !border-white !bg-gray-600"
        />
      )}

      {verdadero && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="verdadero"
          className="!-left-[25%] !h-3 !w-3 !border-2 !border-white !bg-emerald-500"
        />
      )}

      {falso && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="falso"
          className="!left-[125%] !h-3 !w-3 !border-2 !border-white !bg-red-500"
        />
      )}
    </div>
  );
}
