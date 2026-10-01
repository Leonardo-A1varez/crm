"use client";

import { Done, Remove } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import type { ComponentPropsWithoutRef } from "react";

/**
 * Casilla de verificación nativa con el tilde dibujado.
 *
 * Existía como `<input appearance-none checked:bg-ink-primary>` repetido en
 * tres pantallas de Difusión: marcada era un cuadrado lleno sin tilde, que se
 * confunde con un botón apretado o con un bloque de color. Una de esas casillas
 * decide mandarle a toda la base, así que el estado tiene que leerse sin dudar.
 *
 * Sigue siendo un `<input type="checkbox">`: teclado, `label` y lector de
 * pantalla funcionan como siempre. El tilde es un ícono encima, apagado hasta
 * que el input queda `:checked` (`peer-checked`), sin estado en React.
 *
 * El estado mixto ("algunos") es la propiedad DOM `indeterminate`, que no tiene
 * atributo HTML: por eso es un prop propio y se escribe en un efecto. Se dibuja
 * con un guion y el lector de pantalla lo anuncia como parcialmente marcada.
 */
export function Casilla({
  className,
  indeterminate = false,
  ...props
}: Omit<ComponentPropsWithoutRef<"input">, "type"> & { indeterminate?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <span className={cn("relative inline-grid size-[18px] shrink-0", className)}>
      <input
        ref={input}
        type="checkbox"
        {...props}
        className="peer border-line-control checked:bg-ink-primary checked:border-ink-primary indeterminate:bg-ink-primary indeterminate:border-ink-primary focus-visible:ring-brand/60 col-start-1 row-start-1 size-[18px] appearance-none rounded-[5px] border transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      />
      <Done
        aria-hidden
        size={12}
        strokeWidth={3}
        className="text-surface-card pointer-events-none col-start-1 row-start-1 place-self-center opacity-0 transition-opacity duration-100 peer-checked:opacity-100 peer-indeterminate:opacity-0"
      />
      <Remove
        aria-hidden
        size={12}
        strokeWidth={3}
        className="text-surface-card pointer-events-none col-start-1 row-start-1 place-self-center opacity-0 transition-opacity duration-100 peer-indeterminate:opacity-100"
      />
    </span>
  );
}
