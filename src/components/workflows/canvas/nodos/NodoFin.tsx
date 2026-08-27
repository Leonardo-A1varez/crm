"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Square } from "lucide-react";
import { NodoBase } from "./NodoBase";

function NodoFinInner({ selected }: NodeProps) {
  return (
    <NodoBase
      nombre="Fin"
      icono={Square}
      categoria="interno"
      selected={selected}
      tieneEntrada={true}
      tieneSalida={false}
    >
      El flujo termina
    </NodoBase>
  );
}

export const NodoFin = memo(NodoFinInner);
