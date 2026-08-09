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
    <div
      role="radiogroup"
      className="border-line-control bg-surface-input flex gap-1 rounded-[10px] border p-[3px]"
    >
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
              "flex-1 rounded-[7px] py-2 text-[11.5px] font-semibold transition-colors",
              activo
                ? "bg-brand text-brand-ink"
                : "text-ink-dim hover:text-ink-primary bg-transparent",
            )}
          >
            {etiquetas[opcion]}
          </button>
        );
      })}
    </div>
  );
}
