"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";
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
      nombre="Condición"
      icono={GitBranch}
      categoria="logica"
      selected={selected}
      tieneEntrada={true}
      salidasMultiples={[
        { id: "si", label: "Sí" },
        { id: "no", label: "No" },
      ]}
    >
      {resumen}
    </NodoBase>
  );
}

export const NodoCondicion = memo(NodoCondicionInner);
