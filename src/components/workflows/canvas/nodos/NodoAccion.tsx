"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
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
      tipo="accion"
      titulo="Acción"
      color="blue"
      selected={selected}
      handles={{ entrada: true, salida: true }}
    >
      <p className="text-ink-secondary text-[11px] font-medium">{etiqueta}</p>
      {texto && <p className="text-ink-faint mt-1 line-clamp-2 text-[10px]">{texto}</p>}
    </NodoBase>
  );
}

export const NodoAccion = memo(NodoAccionInner);
