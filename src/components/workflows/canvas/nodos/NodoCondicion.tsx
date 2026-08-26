"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { NodoBase } from "./NodoBase";

interface NodoCondicionData extends Record<string, unknown> {
  config: { campo?: string; operador?: string; valor?: string };
}

type NodoCondicionType = Node<NodoCondicionData>;

function NodoCondicionInner({ data, selected }: NodeProps<NodoCondicionType>) {
  const { campo, operador, valor } = data.config ?? {};
  const resumen = campo ? `${campo} ${operador ?? "es"} ${valor ?? "?"}` : "Sin configurar";

  return (
    <NodoBase
      tipo="condicion"
      titulo="Condición"
      color="amber"
      selected={selected}
      handles={{ entrada: true, verdadero: true, falso: true }}
    >
      <p className="text-ink-secondary text-[11px]">{resumen}</p>
      <div className="mt-1 flex justify-between text-[9px]">
        <span className="text-emerald-600">✓ Sí</span>
        <span className="text-red-600">✗ No</span>
      </div>
    </NodoBase>
  );
}

export const NodoCondicion = memo(NodoCondicionInner);
