"use client";

import type { NodeProps, Node } from "@xyflow/react";
import {
  CirclePlus,
  CircleMinus,
  GitBranch,
  User,
  RefreshCw,
  Edit,
  CheckSquare,
  StickyNote,
  Ban,
  Archive,
  Headset,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NodoBase } from "./NodoBase";
import type { NodoTipoCRM } from "@/types/workflows";

interface CRMConfig {
  // crm_etiqueta_add / crm_etiqueta_remove
  etiqueta?: string;
  // crm_etapa
  etapa?: string;
  // crm_vendedor
  vendedor?: string;
  // crm_round_robin
  vendedores?: string[];
  // crm_campo
  campo?: string;
  valor?: string;
  // crm_tarea
  titulo?: string;
  // crm_nota
  texto?: string;
}

interface CRMNodeData extends Record<string, unknown> {
  config: CRMConfig;
}

type CRMNode = Node<CRMNodeData, NodoTipoCRM>;

/** Metadatos de cada tipo de CRM */
const CRM_META: Record<NodoTipoCRM, { nombre: string; icono: LucideIcon }> = {
  crm_etiqueta_add: { nombre: "Asignar etiqueta", icono: CirclePlus },
  crm_etiqueta_remove: { nombre: "Remover etiqueta", icono: CircleMinus },
  crm_etapa: { nombre: "Cambiar etapa", icono: GitBranch },
  crm_vendedor: { nombre: "Asignar vendedor", icono: User },
  crm_round_robin: { nombre: "Round Robin", icono: RefreshCw },
  crm_campo: { nombre: "Actualizar campo", icono: Edit },
  crm_tarea: { nombre: "Crear tarea", icono: CheckSquare },
  crm_nota: { nombre: "Agregar nota", icono: StickyNote },
  crm_spam: { nombre: "Marcar spam", icono: Ban },
  crm_archivar: { nombre: "Archivar", icono: Archive },
  crm_escalar_humano: { nombre: "Escalar a humano", icono: Headset },
};

/** Trunca un string a maxLen caracteres */
function truncar(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/** Genera el texto de preview según la config del CRM */
function getPreview(tipo: NodoTipoCRM, config: CRMConfig): string {
  switch (tipo) {
    case "crm_etiqueta_add":
      return config.etiqueta ? `+${config.etiqueta}` : "Sin etiqueta";
    case "crm_etiqueta_remove":
      return config.etiqueta ? `-${config.etiqueta}` : "Sin etiqueta";
    case "crm_etapa":
      return config.etapa ? `→ ${config.etapa}` : "Sin etapa";
    case "crm_vendedor":
      return config.vendedor ?? "Sin vendedor";
    case "crm_round_robin":
      return config.vendedores?.length
        ? `${config.vendedores.length} vendedores`
        : "Sin vendedores";
    case "crm_campo":
      if (config.campo && config.valor) {
        return truncar(`${config.campo} = ${config.valor}`, 40);
      }
      return config.campo ? `${config.campo} = ?` : "Sin campo";
    case "crm_tarea":
      return config.titulo ? truncar(config.titulo, 40) : "Sin título";
    case "crm_nota":
      return config.texto ? truncar(config.texto, 40) : "Sin texto";
    case "crm_spam":
      return "Marcar spam";
    case "crm_archivar":
      return "Archivar";
    default:
      return "Sin configurar";
  }
}

/**
 * Componente para renderizar todos los nodos de tipo CRM.
 */
export function NodoCRM({ data, selected, type }: NodeProps<CRMNode>) {
  const tipo = (type ?? "crm_etiqueta_add") as NodoTipoCRM;
  const meta = CRM_META[tipo] ?? CRM_META.crm_etiqueta_add;
  const config = (data.config ?? {}) as CRMConfig;
  const preview = getPreview(tipo, config);

  return (
    <NodoBase
      nombre={meta.nombre}
      icono={meta.icono}
      categoria="crm"
      selected={selected ?? false}
      tieneEntrada={true}
      tieneSalida={true}
    >
      {preview}
    </NodoBase>
  );
}
