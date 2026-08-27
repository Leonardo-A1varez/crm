"use client";

import type { NodeProps, Node } from "@xyflow/react";
import {
  MessageSquare,
  Webhook,
  Clock,
  Play,
  Tag,
  CircleX,
  GitBranch,
  UserPlus,
  Users,
  FileText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NodoBase } from "./NodoBase";
import type { NodoTipoTrigger } from "@/types/workflows";

interface TriggerConfig {
  // trigger_mensaje
  canal?: string;
  // trigger_webhook
  webhookId?: string;
  // trigger_cron
  expresion?: string;
  // trigger_etiqueta / trigger_etiqueta_removida
  etiqueta?: string;
  // trigger_etapa
  etapaOrigen?: string;
  etapaDestino?: string;
  // trigger_lead_creado
  canalCreacion?: string;
  // trigger_vendedor_asignado
  vendedor?: string;
  // trigger_inactividad
  tiempo?: string;
  // trigger_formulario
  formulario?: string;
}

interface TriggerNodeData extends Record<string, unknown> {
  config: TriggerConfig;
}

type TriggerNode = Node<TriggerNodeData, NodoTipoTrigger>;

/** Metadatos de cada tipo de trigger */
const TRIGGER_META: Record<NodoTipoTrigger, { nombre: string; icono: LucideIcon }> = {
  trigger_mensaje: { nombre: "Mensaje recibido", icono: MessageSquare },
  trigger_webhook: { nombre: "Webhook", icono: Webhook },
  trigger_cron: { nombre: "Programado", icono: Clock },
  trigger_manual: { nombre: "Manual", icono: Play },
  trigger_etiqueta: { nombre: "Etiqueta asignada", icono: Tag },
  trigger_etiqueta_removida: { nombre: "Etiqueta removida", icono: CircleX },
  trigger_etapa: { nombre: "Etapa cambiada", icono: GitBranch },
  trigger_lead_creado: { nombre: "Lead creado", icono: UserPlus },
  trigger_vendedor_asignado: { nombre: "Vendedor asignado", icono: Users },
  trigger_inactividad: { nombre: "Inactividad", icono: Clock },
  trigger_formulario: { nombre: "Formulario", icono: FileText },
};

/** Genera el texto de preview según la config del trigger */
function getPreview(tipo: NodoTipoTrigger, config: TriggerConfig): string {
  switch (tipo) {
    case "trigger_mensaje":
      return config.canal ? `Canal: ${config.canal}` : "Cualquier canal";
    case "trigger_webhook":
      return config.webhookId ? `POST /webhook/${config.webhookId}` : "Webhook entrante";
    case "trigger_cron":
      return config.expresion ?? "Sin configurar";
    case "trigger_manual":
      return "Click para ejecutar";
    case "trigger_etiqueta":
      return config.etiqueta ? `Etiqueta: ${config.etiqueta}` : "Cualquier etiqueta";
    case "trigger_etiqueta_removida":
      return config.etiqueta ? `Etiqueta: ${config.etiqueta}` : "Cualquier etiqueta";
    case "trigger_etapa":
      if (config.etapaOrigen && config.etapaDestino) {
        return `${config.etapaOrigen} → ${config.etapaDestino}`;
      }
      return config.etapaDestino ? `→ ${config.etapaDestino}` : "Cualquier cambio";
    case "trigger_lead_creado":
      return config.canalCreacion ? `Canal: ${config.canalCreacion}` : "Cualquier canal";
    case "trigger_vendedor_asignado":
      return config.vendedor ? `Vendedor: ${config.vendedor}` : "Cualquier vendedor";
    case "trigger_inactividad":
      return config.tiempo ? `Sin respuesta: ${config.tiempo}` : "Tiempo sin configurar";
    case "trigger_formulario":
      return config.formulario ? `Form: ${config.formulario}` : "Cualquier formulario";
    default:
      return "Sin configurar";
  }
}

/**
 * Componente para renderizar todos los nodos de tipo Trigger.
 * No tiene handle de entrada (es el inicio del flujo).
 */
export function NodoTrigger({ data, selected, type }: NodeProps<TriggerNode>) {
  const tipo = (type ?? "trigger_mensaje") as NodoTipoTrigger;
  const meta = TRIGGER_META[tipo] ?? TRIGGER_META.trigger_mensaje;
  const config = (data.config ?? {}) as TriggerConfig;
  const preview = getPreview(tipo, config);

  return (
    <NodoBase
      nombre={meta.nombre}
      icono={meta.icono}
      categoria="trigger"
      selected={selected ?? false}
      tieneEntrada={false}
      tieneSalida={true}
    >
      {preview}
    </NodoBase>
  );
}
