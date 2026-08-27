/**
 * Estados visuales del historial de workflows.
 *
 * El brief especifica:
 * - ejecutando: azul, PlayCircle
 * - esperando: ambar, Clock
 * - completado: verde, CheckCircle
 * - error: rojo, XCircle
 * - cancelado: gris, Ban
 */
import {
  PlayCircle,
  Clock,
  CheckCircle,
  XCircle,
  Ban,
  Circle,
  Loader2,
  MinusCircle,
} from "lucide-react";
import type { WorkflowRunEstado } from "@/types/entities";
import type { ComponentType } from "react";

export interface EstadoRunConfig {
  icono: ComponentType<{ size?: number; className?: string }>;
  color: string;
  bg: string;
  label: string;
}

export const ESTADOS_RUN: Record<WorkflowRunEstado, EstadoRunConfig> = {
  corriendo: {
    icono: PlayCircle,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-500/10",
    label: "En ejecucion",
  },
  esperando: {
    icono: Clock,
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    label: "Esperando",
  },
  terminado: {
    icono: CheckCircle,
    color: "text-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    label: "Completado",
  },
  fallado: {
    icono: XCircle,
    color: "text-red-500",
    bg: "bg-red-50 dark:bg-red-500/10",
    label: "Error",
  },
  cancelado: {
    icono: Ban,
    color: "text-gray-500",
    bg: "bg-gray-50 dark:bg-gray-500/10",
    label: "Cancelado",
  },
};

/** Estados de un paso individual en la timeline */
export type EstadoPaso = "ok" | "error" | "skipped" | "running" | "pending";

export interface EstadoPasoConfig {
  icono: ComponentType<{ size?: number; className?: string }>;
  color: string;
  bg: string;
}

export const ESTADOS_PASO: Record<EstadoPaso, EstadoPasoConfig> = {
  ok: {
    icono: CheckCircle,
    color: "text-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
  },
  error: {
    icono: XCircle,
    color: "text-red-500",
    bg: "bg-red-50 dark:bg-red-500/10",
  },
  skipped: {
    icono: MinusCircle,
    color: "text-gray-400",
    bg: "bg-gray-50 dark:bg-gray-500/10",
  },
  running: {
    icono: Loader2,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-500/10",
  },
  pending: {
    icono: Circle,
    color: "text-gray-300",
    bg: "bg-gray-50 dark:bg-gray-500/10",
  },
};
