"use client";

import type { NodeProps, Node } from "@xyflow/react";
import { Globe, Send, Code, Mail, Sheet, Database } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NodoBase } from "./NodoBase";
import type { NodoTipoIntegracion } from "@/types/workflows";

interface IntegracionConfig {
  // int_http
  method?: string;
  url?: string;
  // int_webhook_out
  webhookUrl?: string;
  // int_codigo
  codigo?: string;
  // int_email
  destinatario?: string;
  // int_sheets
  spreadsheet?: string;
  // int_db
  query?: string;
}

interface IntegracionNodeData extends Record<string, unknown> {
  config: IntegracionConfig;
}

type IntegracionNode = Node<IntegracionNodeData, NodoTipoIntegracion>;

/** Metadatos de cada tipo de integración */
const INTEGRACION_META: Record<NodoTipoIntegracion, { nombre: string; icono: LucideIcon }> = {
  int_http: { nombre: "HTTP Request", icono: Globe },
  int_webhook_out: { nombre: "Webhook saliente", icono: Send },
  int_codigo: { nombre: "Código JS", icono: Code },
  int_email: { nombre: "Enviar email", icono: Mail },
  int_sheets: { nombre: "Google Sheets", icono: Sheet },
  int_db: { nombre: "Base de datos", icono: Database },
};

/** Trunca un string a maxLen caracteres */
function truncar(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/** Cuenta las líneas de código */
function contarLineas(codigo: string): number {
  return codigo.split("\n").filter((l) => l.trim()).length;
}

/** Genera el texto de preview según la config de integración */
function getPreview(tipo: NodoTipoIntegracion, config: IntegracionConfig): string {
  switch (tipo) {
    case "int_http":
      if (config.method && config.url) {
        return truncar(`${config.method} ${config.url}`, 40);
      }
      return config.url ? truncar(config.url, 40) : "Sin URL";
    case "int_webhook_out":
      return config.webhookUrl ? truncar(config.webhookUrl, 40) : "Sin URL";
    case "int_codigo":
      return config.codigo ? `${contarLineas(config.codigo)} líneas` : "Sin código";
    case "int_email":
      return config.destinatario ? `Para: ${config.destinatario}` : "Sin destinatario";
    case "int_sheets":
      return config.spreadsheet ?? "Sin spreadsheet";
    case "int_db":
      return config.query ? `Query: ${config.query.length} chars` : "Sin query";
    default:
      return "Sin configurar";
  }
}

/**
 * Componente para renderizar todos los nodos de tipo Integración.
 */
export function NodoIntegracion({ data, selected, type }: NodeProps<IntegracionNode>) {
  const tipo = (type ?? "int_http") as NodoTipoIntegracion;
  const meta = INTEGRACION_META[tipo] ?? INTEGRACION_META.int_http;
  const config = (data.config ?? {}) as IntegracionConfig;
  const preview = getPreview(tipo, config);

  return (
    <NodoBase
      nombre={meta.nombre}
      icono={meta.icono}
      categoria="integracion"
      selected={selected ?? false}
      tieneEntrada={true}
      tieneSalida={true}
    >
      {preview}
    </NodoBase>
  );
}
