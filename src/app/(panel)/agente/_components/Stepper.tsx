"use client";

import { Add, Remove } from "@/components/icons";

/**
 * Stepper "− valor +" del handoff §4.2: valor en Geist Mono 11.5px y ancho
 * mínimo de 62px para que la caja no salte de tamaño al pasar de 5 a 20.
 */
export function Stepper({
  valor,
  texto,
  min,
  max,
  paso,
  etiqueta,
  onChange,
  disabled,
}: {
  valor: number;
  /** Cómo se muestra el valor (con unidad). Sin esto se vería el número pelado. */
  texto: string;
  min: number;
  max: number;
  paso: number;
  etiqueta: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const acotar = (v: number) => Math.min(max, Math.max(min, Number(v.toFixed(2))));

  return (
    <div className="border-line-control bg-surface-input flex shrink-0 items-center rounded-[9px] border">
      <button
        type="button"
        aria-label={`Bajar ${etiqueta}`}
        disabled={disabled || valor <= min}
        onClick={() => onChange(acotar(valor - paso))}
        className="text-ink-dim hover:text-ink-primary px-2 py-1.5 transition-colors disabled:opacity-40"
      >
        <Remove size={12} />
      </button>
      <span className="text-ink-body min-w-[62px] text-center font-mono text-[11.5px] tabular-nums">
        {texto}
      </span>
      <button
        type="button"
        aria-label={`Subir ${etiqueta}`}
        disabled={disabled || valor >= max}
        onClick={() => onChange(acotar(valor + paso))}
        className="text-ink-dim hover:text-ink-primary px-2 py-1.5 transition-colors disabled:opacity-40"
      >
        <Add size={12} />
      </button>
    </div>
  );
}
