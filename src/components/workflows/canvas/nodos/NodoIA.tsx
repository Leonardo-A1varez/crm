"use client";

import type { NodeProps, Node } from "@xyflow/react";
import { Brain, Bot, FileSearch, Smile, FileText, Languages, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NodoBase } from "./NodoBase";
import type { NodoTipoIA } from "@/types/workflows";

interface IAConfig {
  // ia_clasificar
  intents?: string[];
  // ia_responder
  modelo?: string;
  // ia_extraer
  campos?: string[];
  // ia_traducir
  idioma?: string;
  // ia_spam
  umbral?: number;
}

interface IANodeData extends Record<string, unknown> {
  config: IAConfig;
}

type IANode = Node<IANodeData, NodoTipoIA>;

/** Metadatos de cada tipo de IA */
const IA_META: Record<NodoTipoIA, { nombre: string; icono: LucideIcon }> = {
  ia_clasificar: { nombre: "Clasificar intent", icono: Brain },
  ia_responder: { nombre: "Generar respuesta", icono: Bot },
  ia_extraer: { nombre: "Extraer datos", icono: FileSearch },
  ia_sentimiento: { nombre: "Sentimiento", icono: Smile },
  ia_resumir: { nombre: "Resumir", icono: FileText },
  ia_traducir: { nombre: "Traducir", icono: Languages },
  ia_spam: { nombre: "Verificar spam", icono: ShieldAlert },
};

/** Genera el texto de preview según la config de IA */
function getPreview(tipo: NodoTipoIA, config: IAConfig): string {
  switch (tipo) {
    case "ia_clasificar":
      return config.intents?.length ? `${config.intents.length} intents` : "Sin intents";
    case "ia_responder":
      return config.modelo ? `Modelo: ${config.modelo}` : "Modelo por defecto";
    case "ia_extraer":
      return config.campos?.length ? `${config.campos.length} campos` : "Sin campos";
    case "ia_sentimiento":
      return "Analizar emoción";
    case "ia_resumir":
      return "Resumir conv.";
    case "ia_traducir":
      return config.idioma ? `→ ${config.idioma}` : "Sin idioma";
    case "ia_spam":
      return config.umbral !== undefined ? `Umbral: ${config.umbral}%` : "Umbral por defecto";
    default:
      return "Sin configurar";
  }
}

/**
 * Componente para renderizar todos los nodos de tipo IA.
 */
export function NodoIA({ data, selected, type }: NodeProps<IANode>) {
  const tipo = (type ?? "ia_clasificar") as NodoTipoIA;
  const meta = IA_META[tipo] ?? IA_META.ia_clasificar;
  const config = (data.config ?? {}) as IAConfig;
  const preview = getPreview(tipo, config);

  return (
    <NodoBase
      nombre={meta.nombre}
      icono={meta.icono}
      categoria="ia"
      selected={selected ?? false}
      tieneEntrada={true}
      tieneSalida={true}
    >
      {preview}
    </NodoBase>
  );
}
