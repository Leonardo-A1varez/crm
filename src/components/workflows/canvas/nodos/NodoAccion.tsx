"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Send } from "lucide-react";
import { NodoBase } from "./NodoBase";
import { ETIQUETA_ACCION } from "@/lib/workflows/catalogo";
import type { AccionWorkflow } from "@/lib/workflows/catalogo";

interface NodoAccionData extends Record<string, unknown> {
  config: { accion?: AccionWorkflow; texto?: string };
}

type NodoAccionType = Node<NodoAccionData>;

function NodoAccionInner({ data, selected }: NodeProps<NodoAccionType>) {
  const accion = data.config?.accion ?? "enviar_mensaje";
  const etiqueta = ETIQUETA_ACCION[accion] ?? accion;
  const texto = data.config?.texto;

  return (
    <NodoBase
      nombre="Acción"
      icono={Send}
      categoria="mensajeria"
      selected={selected}
      tieneEntrada={true}
      tieneSalida={true}
    >
      <span className="font-medium">{etiqueta}</span>
      {texto && <span className="mt-1 line-clamp-2 text-[10px] opacity-70">{texto}</span>}
    </NodoBase>
  );
}

export const NodoAccion = memo(NodoAccionInner);
