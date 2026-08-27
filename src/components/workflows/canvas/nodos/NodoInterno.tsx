"use client";

import type { NodeProps, Node } from "@xyflow/react";
import { Bell, Users, MessageSquare, Bug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NodoBase } from "./NodoBase";
import type { NodoTipoInterno } from "@/types/workflows";

interface InternoConfig {
  // int_notif_vendedor
  canal?: string;
  // int_notif_grupo
  grupo?: string;
  // int_comentario
  texto?: string;
}

interface InternoNodeData extends Record<string, unknown> {
  config: InternoConfig;
}

type InternoNode = Node<InternoNodeData, NodoTipoInterno>;

/** Metadatos de cada tipo interno */
const INTERNO_META: Record<NodoTipoInterno, { nombre: string; icono: LucideIcon }> = {
  int_notif_vendedor: { nombre: "Notificar vendedor", icono: Bell },
  int_notif_grupo: { nombre: "Notificar grupo", icono: Users },
  int_comentario: { nombre: "Comentario interno", icono: MessageSquare },
  int_debug: { nombre: "Log/Debug", icono: Bug },
};

/** Trunca un string a maxLen caracteres */
function truncar(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/** Genera el texto de preview según la config interna */
function getPreview(tipo: NodoTipoInterno, config: InternoConfig): string {
  switch (tipo) {
    case "int_notif_vendedor":
      return config.canal ?? "Al vendedor asignado";
    case "int_notif_grupo":
      return config.grupo ?? "Sin grupo";
    case "int_comentario":
      return config.texto ? truncar(config.texto, 40) : "Sin texto";
    case "int_debug":
      return "Log datos";
    default:
      return "Sin configurar";
  }
}

/**
 * Componente para renderizar todos los nodos de tipo Interno.
 */
export function NodoInterno({ data, selected, type }: NodeProps<InternoNode>) {
  const tipo = (type ?? "int_notif_vendedor") as NodoTipoInterno;
  const meta = INTERNO_META[tipo] ?? INTERNO_META.int_notif_vendedor;
  const config = (data.config ?? {}) as InternoConfig;
  const preview = getPreview(tipo, config);

  return (
    <NodoBase
      nombre={meta.nombre}
      icono={meta.icono}
      categoria="interno"
      selected={selected ?? false}
      tieneEntrada={true}
      tieneSalida={true}
    >
      {preview}
    </NodoBase>
  );
}
