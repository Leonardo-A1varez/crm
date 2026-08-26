"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { NodoBase } from "./NodoBase";

interface NodoEsperaData extends Record<string, unknown> {
  config: { minutos?: number };
}

type NodoEsperaType = Node<NodoEsperaData>;

function NodoEsperaInner({ data, selected }: NodeProps<NodoEsperaType>) {
  const minutos = data.config?.minutos ?? 60;
  const texto = minutos >= 60 ? `${Math.floor(minutos / 60)}h ${minutos % 60}m` : `${minutos}m`;

  return (
    <NodoBase
      tipo="espera"
      titulo="Espera"
      color="gray"
      selected={selected}
      handles={{ entrada: true, salida: true }}
    >
      <p className="text-ink-secondary text-[11px]">Esperar {texto}</p>
    </NodoBase>
  );
}

export const NodoEspera = memo(NodoEsperaInner);
