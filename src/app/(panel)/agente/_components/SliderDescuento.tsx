"use client";

import { Stepper } from "./Stepper";

const MIN = 0;
const MAX = 20;
const PASO = 0.5;

/**
 * Slider del handoff §4.3: track de 5px, relleno con gradiente ámbar y knob de
 * 15px con borde del color de la tarjeta.
 *
 * El relleno va en el `background` del propio input y el track nativo queda
 * transparente. Es la única forma de que el gradiente llegue hasta el valor
 * actual sin poder escribir estilos inline en un pseudo-elemento.
 */
export function SliderDescuento({
  valor,
  onChange,
  disabled,
}: {
  valor: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const pct = ((valor - MIN) / (MAX - MIN)) * 100;

  return (
    <div className="flex items-center gap-4">
      <input
        type="range"
        min={MIN}
        max={MAX}
        step={PASO}
        value={valor}
        aria-label="Descuento máximo en porcentaje"
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        style={{
          background: `linear-gradient(to right, var(--color-brand-deep) 0%, var(--color-brand-hover) ${pct}%, var(--color-line-control) ${pct}%, var(--color-line-control) 100%)`,
        }}
        className="h-[5px] w-full min-w-0 appearance-none rounded-full disabled:opacity-50 [&::-moz-range-thumb]:h-[15px] [&::-moz-range-thumb]:w-[15px] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--color-surface-card)] [&::-moz-range-thumb]:bg-[var(--color-brand-hover)] [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-[5px] [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-[15px] [&::-webkit-slider-thumb]:w-[15px] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-surface-card)] [&::-webkit-slider-thumb]:bg-[var(--color-brand-hover)]"
      />
      <Stepper
        valor={valor}
        texto={`${valor}%`}
        min={MIN}
        max={MAX}
        paso={PASO}
        etiqueta="descuento máximo"
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}
