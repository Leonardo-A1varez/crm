"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { NodoBase } from "./NodoBase";
import { ETIQUETA_DISPARADOR } from "@/lib/workflows/catalogo";
import type { DisparadorWorkflow } from "@/lib/workflows/catalogo";

interface NodoDisparadorData extends Record<string, unknown> {
  config: { disparador?: DisparadorWorkflow };
}

type NodoDisparadorType = Node<NodoDisparadorData>;

function NodoDisparadorInner({ data, selected }: NodeProps<NodoDisparadorType>) {
  const disparador = data.config?.disparador ?? "mensaje_recibido";
  const etiqueta = ETIQUETA_DISPARADOR[disparador] ?? disparador;

  return (
    <NodoBase
      nombre="Disparador"
      icono={Zap}
      categoria="trigger"
      selected={selected}
      tieneEntrada={false}
      tieneSalida={true}
    >
      {etiqueta}
    </NodoBase>
  );
}

export const NodoDisparador = memo(NodoDisparadorInner);
