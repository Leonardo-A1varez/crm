"use client";

import { cn } from "@/lib/utils";
import type { ModoCentro } from "@/components/whatsapp/usePreferenciaVistaCentro";

const OPCIONES: readonly { modo: ModoCentro; etiqueta: string }[] = [
  { modo: "whatsapp", etiqueta: "WhatsApp Web" },
  { modo: "hilo", etiqueta: "Hilo del CRM" },
];

/**
 * Segmentado WhatsApp Web / Hilo del CRM. Mismo patrón que `SelectorOrden` del
 * panel de lista (grupo de botones con `aria-pressed`) para que los dos
 * controles de la pantalla se lean como la misma familia.
 */
export function SelectorVistaCentro({
  modo,
  onCambiar,
}: {
  modo: ModoCentro;
  onCambiar: (modo: ModoCentro) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Qué mostrar de la conversación"
      className="bg-surface-elevated border-line-card flex shrink-0 gap-0.5 rounded-[10px] border p-[3px]"
    >
      {OPCIONES.map(({ modo: opcion, etiqueta }) => {
        const activo = opcion === modo;
        return (
          <button
            key={opcion}
            type="button"
            aria-pressed={activo}
            onClick={() => onCambiar(opcion)}
            className={cn(
              "focus-visible:ring-ring/50 h-[26px] rounded-[7px] px-3 text-[11.5px] whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:outline-none",
              activo ? "bg-brand text-brand-ink font-semibold" : "text-ink-dim bg-transparent",
            )}
          >
            {etiqueta}
          </button>
        );
      })}
    </div>
  );
}
