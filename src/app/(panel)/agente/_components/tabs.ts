export const TABS_AGENTE = ["reglas", "escalado", "comporta", "limites"] as const;
export type TabAgente = (typeof TABS_AGENTE)[number];

/**
 * Módulo aparte de `TabsConsola.tsx` a propósito: la página es un Server
 * Component y necesita validar el `?tab=` de la URL. Todo lo que se exporta
 * desde un archivo con `"use client"` llega al server como referencia y no se
 * puede ejecutar ahí, así que el guard tiene que vivir en un módulo neutro.
 */
export function esTabAgente(v: string | undefined): v is TabAgente {
  return (TABS_AGENTE as readonly string[]).includes(v ?? "");
}
