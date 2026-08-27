"use client";

import type { NodeProps, Node } from "@xyflow/react";
import { Send, LayoutGrid, List, Image, File, MapPin, FileText, Heart } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NodoBase } from "./NodoBase";
import type { NodoTipoMensajeria } from "@/types/workflows";

interface MensajeriaConfig {
  // msg_texto
  mensaje?: string;
  // msg_botones
  botones?: Array<{ texto: string }>;
  // msg_lista
  opciones?: Array<{ texto: string }>;
  // msg_imagen
  imagenUrl?: string;
  imagenNombre?: string;
  // msg_documento
  documentoUrl?: string;
  documentoNombre?: string;
  // msg_ubicacion
  ubicacionNombre?: string;
  // msg_plantilla
  plantilla?: string;
  // msg_reaccion
  emoji?: string;
}

interface MensajeriaNodeData extends Record<string, unknown> {
  config: MensajeriaConfig;
}

type MensajeriaNode = Node<MensajeriaNodeData, NodoTipoMensajeria>;

/** Metadatos de cada tipo de mensajería */
const MENSAJERIA_META: Record<NodoTipoMensajeria, { nombre: string; icono: LucideIcon }> = {
  msg_texto: { nombre: "Enviar mensaje", icono: Send },
  msg_botones: { nombre: "Mensaje con botones", icono: LayoutGrid },
  msg_lista: { nombre: "Mensaje de lista", icono: List },
  msg_imagen: { nombre: "Enviar imagen", icono: Image },
  msg_documento: { nombre: "Enviar documento", icono: File },
  msg_ubicacion: { nombre: "Enviar ubicación", icono: MapPin },
  msg_plantilla: { nombre: "Plantilla HSM", icono: FileText },
  msg_reaccion: { nombre: "Reacción", icono: Heart },
};

/** Trunca un string a maxLen caracteres */
function truncar(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/** Genera el texto de preview según la config del mensaje */
function getPreview(tipo: NodoTipoMensajeria, config: MensajeriaConfig): string {
  switch (tipo) {
    case "msg_texto":
      return config.mensaje ? truncar(config.mensaje, 50) : "Sin mensaje";
    case "msg_botones":
      return config.botones?.length ? `${config.botones.length} botones` : "Sin botones";
    case "msg_lista":
      return config.opciones?.length ? `${config.opciones.length} opciones` : "Sin opciones";
    case "msg_imagen":
      return config.imagenNombre ?? truncar(config.imagenUrl ?? "Sin imagen", 30);
    case "msg_documento":
      return config.documentoNombre ?? truncar(config.documentoUrl ?? "Sin documento", 30);
    case "msg_ubicacion":
      return config.ubicacionNombre ?? "Sin ubicación";
    case "msg_plantilla":
      return config.plantilla ? `Plantilla: ${config.plantilla}` : "Sin plantilla";
    case "msg_reaccion":
      return config.emoji ?? "Sin emoji";
    default:
      return "Sin configurar";
  }
}

/**
 * Componente para renderizar todos los nodos de tipo Mensajería.
 */
export function NodoMensajeria({ data, selected, type }: NodeProps<MensajeriaNode>) {
  const tipo = (type ?? "msg_texto") as NodoTipoMensajeria;
  const meta = MENSAJERIA_META[tipo] ?? MENSAJERIA_META.msg_texto;
  const config = (data.config ?? {}) as MensajeriaConfig;
  const preview = getPreview(tipo, config);

  return (
    <NodoBase
      nombre={meta.nombre}
      icono={meta.icono}
      categoria="mensajeria"
      selected={selected ?? false}
      tieneEntrada={true}
      tieneSalida={true}
    >
      {preview}
    </NodoBase>
  );
}
