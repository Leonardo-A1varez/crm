"use client";

import { Done } from "@/components/icons";
import { cn } from "@/lib/utils";
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
 */
export function Casilla({ className, ...props }: Omit<ComponentPropsWithoutRef<"input">, "type">) {
  return (
    <span className={cn("relative inline-grid size-[18px] shrink-0", className)}>
      <input
        type="checkbox"
        {...props}
        className="peer border-line-control checked:bg-ink-primary checked:border-ink-primary focus-visible:ring-brand/60 col-start-1 row-start-1 size-[18px] appearance-none rounded-[5px] border transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      />
      <Done
        aria-hidden
        size={12}
        strokeWidth={3}
        className="text-surface-card pointer-events-none col-start-1 row-start-1 place-self-center opacity-0 transition-opacity duration-100 peer-checked:opacity-100"
      />
    </span>
  );
}
