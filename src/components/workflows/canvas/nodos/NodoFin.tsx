"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { NodoBase } from "./NodoBase";

function NodoFinInner({ selected }: NodeProps) {
  return (
    <NodoBase tipo="fin" titulo="Fin" color="red" selected={selected} handles={{ entrada: true }}>
      <p className="text-ink-faint text-[10px]">El flujo termina</p>
    </NodoBase>
  );
}

export const NodoFin = memo(NodoFinInner);
