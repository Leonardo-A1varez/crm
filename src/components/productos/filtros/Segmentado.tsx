"use client";

import { useId } from "react";

/**
 * Elegir una opción entre pocas, en una fila. Son radios nativos —flechas, grupo y
 * lector de pantalla funcionan solos— con la etiqueta como botón.
 */
export function Segmentado<T extends string>({
  leyenda,
  opciones,
  valor,
  onCambiar,
  deshabilitado,
}: {
  /** Qué se está eligiendo; lo lee el lector de pantalla. */
  leyenda: string;
  opciones: readonly { valor: T; texto: string }[];
  valor: T;
  onCambiar: (valor: T) => void;
  deshabilitado?: boolean;
}) {
  const nombre = useId();
  return (
    <fieldset
      disabled={deshabilitado}
      className="border-line-control flex min-w-0 gap-0.5 rounded-[9px] border p-0.5 disabled:opacity-45"
    >
      <legend className="sr-only">{leyenda}</legend>
      {opciones.map((o) => (
        <label
          key={o.valor}
          className="text-ink-dim hover:text-ink-secondary has-checked:bg-surface-avatar has-checked:text-ink-primary has-focus-visible:ring-brand/60 flex-1 cursor-pointer rounded-[7px] px-2 py-1 text-center text-[11.5px] font-[550] whitespace-nowrap transition-colors has-focus-visible:ring-2"
        >
          <input
            type="radio"
            name={nombre}
            value={o.valor}
            checked={valor === o.valor}
            onChange={() => onCambiar(o.valor)}
            className="sr-only"
          />
          {o.texto}
        </label>
      ))}
    </fieldset>
  );
}
