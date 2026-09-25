import { ErrorIcon, PlayIcon, Remove, Schedule, ShieldTope, TaskAlt } from "@/components/icons";
import type { FinDeCorrida } from "@/components/workflows/lista/tipos";
import type { ComponentType } from "react";

export interface DescriptorFin {
  label: string;
  glifo: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  color: string;
}

/**
 * Cómo terminó una corrida.
 *
 * Cinco estados con cinco siluetas distintas —tilde, triángulo, play, reloj,
 * guión— por el mismo motivo que en `estado.ts`: ámbar y rojo se separaban
 * ΔE 9.9 en visión normal (el piso duro es 15), o sea que ni siquiera hacía
 * falta daltonismo para confundir "esperando" con "fallada" si el único
 * diferenciador fuera el color. El re-escalonado del 2026-09-03 los llevó a
 * 15.2 normal, pero 6.0 en deuteranopía: la banda que el validador admite sólo
 * con codificación secundaria. En una tabla de 147 filas eso no es un detalle
 * estético: es no encontrar la que rompió.
 *
 * `saltada` es una corrida que un tope de seguridad cortó (PRD §6.6): terminó,
 * no falló. Lleva escudo —el tope protegió al lead— y un color que no es el
 * de ningún fallo, para que una tabla llena de leads protegidos no se lea
 * como una tabla llena de errores.
 */
export const DESCRIPTOR_FIN: Record<FinDeCorrida, DescriptorFin> = {
  terminada: { label: "Terminada", glifo: TaskAlt, color: "var(--color-ok)" },
  saltada: { label: "Salió por tope", glifo: ShieldTope, color: "var(--color-special)" },
  fallada: { label: "Falló", glifo: ErrorIcon, color: "var(--color-danger)" },
  corriendo: { label: "Corriendo", glifo: PlayIcon, color: "var(--color-info)" },
  esperando: { label: "Esperando", glifo: Schedule, color: "var(--color-caution)" },
  cancelada: { label: "Cancelada", glifo: Remove, color: "var(--color-ink-faint)" },
};
