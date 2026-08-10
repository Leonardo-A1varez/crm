"use client";

import { cn } from "@/lib/utils";

/**
 * Segmentado genérico sobre una unión de strings. Genérico y no tres copias
 * tipadas a mano porque tono, largo y emojis tienen la misma forma exacta y
 * divergirían al primer ajuste de estilo.
 */
export function SegmentedControl<T extends string>({
  opciones,
  valor,
  onChange,
  etiquetas,
  disabled,
}: {
  opciones: readonly T[];
  valor: T;
  onChange: (v: T) => void;
  /** Texto visible por opción. Sin esto se mostraría el slug crudo. */
  etiquetas: Record<T, string>;
  disabled?: boolean;
}) {
  return (
    // Sin contenedor con borde: el handoff §4.3 le da borde y fondo propios a
    // cada botón inactivo, no a la caja que los agrupa.
    <div role="radiogroup" className="flex gap-1.5">
      {opciones.map((opcion) => {
        const activo = opcion === valor;
        return (
          <button
            key={opcion}
            type="button"
            role="radio"
            aria-checked={activo}
            disabled={disabled}
            onClick={() => onChange(opcion)}
            className={cn(
              "flex-1 rounded-[9px] py-2 text-[11.5px] font-semibold transition-colors duration-[160ms] disabled:opacity-50",
              activo
                ? "bg-brand text-brand-ink"
                : "bg-surface-input border-line-control text-ink-dim hover:text-ink-primary border",
            )}
          >
            {etiquetas[opcion]}
          </button>
        );
      })}
    </div>
  );
}
