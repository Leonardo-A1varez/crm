"use client";

import type { NodeProps, Node } from "@xyflow/react";
import {
  GitBranch,
  GitMerge,
  CheckCircle,
  Clock,
  MessageCircle,
  Radio,
  Repeat,
  Box,
  CornerDownRight,
  Square,
  AlertTriangle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NodoBase, type SalidaMultiple } from "./NodoBase";
import type { NodoTipoLogica } from "@/types/workflows";

interface LogicaConfig {
  // logica_condicion
  campo?: string;
  operador?: string;
  valor?: string;
  // logica_switch
  casos?: Array<{ valor: string; nombre?: string }>;
  // logica_validacion
  expresion?: string;
  // logica_esperar
  cantidad?: number;
  unidad?: string;
  // logica_esperar_respuesta / logica_esperar_evento
  timeout?: number;
  evento?: string;
  // logica_loop
  item?: string;
  // logica_grupo
  nodosCount?: number;
  // logica_goto
  nodoDestino?: string;
  // logica_detener
  estado?: string;
  // logica_error
  nodoProtegido?: string;
}

interface LogicaNodeData extends Record<string, unknown> {
  config: LogicaConfig;
}

type LogicaNode = Node<LogicaNodeData, NodoTipoLogica>;

/** Metadatos de cada tipo de lógica */
const LOGICA_META: Record<NodoTipoLogica, { nombre: string; icono: LucideIcon }> = {
  logica_condicion: { nombre: "Condición (IF)", icono: GitBranch },
  logica_switch: { nombre: "Switch", icono: GitMerge },
  logica_validacion: { nombre: "Validación", icono: CheckCircle },
  logica_esperar: { nombre: "Esperar tiempo", icono: Clock },
  logica_esperar_respuesta: { nombre: "Esperar respuesta", icono: MessageCircle },
  logica_esperar_evento: { nombre: "Esperar evento", icono: Radio },
  logica_loop: { nombre: "Loop", icono: Repeat },
  logica_grupo: { nombre: "Agrupar", icono: Box },
  logica_goto: { nombre: "Ir a nodo", icono: CornerDownRight },
  logica_detener: { nombre: "Detener", icono: Square },
  logica_error: { nombre: "Error handler", icono: AlertTriangle },
};

/** Determina las salidas múltiples según el tipo */
function getSalidas(tipo: NodoTipoLogica, config: LogicaConfig): SalidaMultiple[] | undefined {
  switch (tipo) {
    case "logica_condicion":
      return [
        { id: "si", label: "Sí", color: "!bg-emerald-500" },
        { id: "no", label: "No", color: "!bg-red-500" },
      ];
    case "logica_switch":
      // Genera salidas dinámicas según los casos configurados
      if (config.casos?.length) {
        return config.casos.map((caso, i) => ({
          id: `caso_${i}`,
          label: caso.nombre ?? caso.valor,
          color: "!bg-amber-500",
        }));
      }
      // Default: 2 casos de ejemplo
      return [
        { id: "caso_0", label: "Caso 1", color: "!bg-amber-500" },
        { id: "caso_1", label: "Caso 2", color: "!bg-amber-500" },
        { id: "default", label: "Default", color: "!bg-gray-500" },
      ];
    case "logica_validacion":
      return [
        { id: "ok", label: "Ok", color: "!bg-emerald-500" },
        { id: "error", label: "Error", color: "!bg-red-500" },
      ];
    case "logica_esperar_respuesta":
      return [
        { id: "respuesta", label: "Resp", color: "!bg-emerald-500" },
        { id: "timeout", label: "Timeout", color: "!bg-red-500" },
      ];
    case "logica_esperar_evento":
      return [
        { id: "evento", label: "Evento", color: "!bg-emerald-500" },
        { id: "timeout", label: "Timeout", color: "!bg-red-500" },
      ];
    case "logica_error":
      return [
        { id: "ok", label: "Ok", color: "!bg-emerald-500" },
        { id: "error", label: "Error", color: "!bg-red-500" },
      ];
    case "logica_goto":
    case "logica_detener":
      // Sin salidas
      return undefined;
    default:
      // Salida simple: loop, grupo, esperar
      return undefined;
  }
}

/** Genera el texto de preview según la config de lógica */
function getPreview(tipo: NodoTipoLogica, config: LogicaConfig): string {
  switch (tipo) {
    case "logica_condicion":
      if (config.campo && config.operador && config.valor) {
        return `${config.campo} ${config.operador} ${config.valor}`;
      }
      return config.campo ? `${config.campo} ?` : "Sin condición";
    case "logica_switch":
      return config.casos?.length
        ? `${config.campo ?? "campo"}: ${config.casos.length} casos`
        : "Sin casos";
    case "logica_validacion":
      return config.expresion ?? "Sin expresión";
    case "logica_esperar":
      if (config.cantidad && config.unidad) {
        return `${config.cantidad} ${config.unidad}`;
      }
      return "Sin tiempo";
    case "logica_esperar_respuesta":
      return config.timeout ? `Timeout: ${config.timeout}m` : "Sin timeout";
    case "logica_esperar_evento":
      return config.evento ? `Evento: ${config.evento}` : "Sin evento";
    case "logica_loop":
      return config.item ? `Para cada ${config.item}` : "Sin lista";
    case "logica_grupo":
      return config.nodosCount ? `${config.nodosCount} nodos` : "Grupo vacío";
    case "logica_goto":
      return config.nodoDestino ? `→ ${config.nodoDestino}` : "Sin destino";
    case "logica_detener":
      return config.estado ?? "Terminar";
    case "logica_error":
      return config.nodoProtegido ? `Protege: ${config.nodoProtegido}` : "Sin nodo";
    default:
      return "Sin configurar";
  }
}

/**
 * Componente para renderizar todos los nodos de tipo Lógica.
 * Maneja handles múltiples para condición, switch, validación, etc.
 */
export function NodoLogica({ data, selected, type }: NodeProps<LogicaNode>) {
  const tipo = (type ?? "logica_condicion") as NodoTipoLogica;
  const meta = LOGICA_META[tipo] ?? LOGICA_META.logica_condicion;
  const config = (data.config ?? {}) as LogicaConfig;
  const preview = getPreview(tipo, config);
  const salidas = getSalidas(tipo, config);

  // goto y detener no tienen salidas
  const tieneSalida = tipo !== "logica_goto" && tipo !== "logica_detener" && !salidas;

  return (
    <NodoBase
      nombre={meta.nombre}
      icono={meta.icono}
      categoria="logica"
      selected={selected ?? false}
      tieneEntrada={true}
      tieneSalida={tieneSalida}
      salidasMultiples={salidas}
    >
      {preview}
    </NodoBase>
  );
}
