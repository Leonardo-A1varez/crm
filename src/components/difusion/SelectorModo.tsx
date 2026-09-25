"use client";

import { cn } from "@/lib/utils";
import { formatearEntero } from "./formato";
import type { ModoAudiencia } from "./tipos";

const OPCIONES: {
  modo: ModoAudiencia;
  titulo: string;
  detalle: (n: number | null) => string;
}[] = [
  {
    modo: "congelada",
    titulo: "Los que ya califican",
    // `null` = todavía hay una condición sin terminar, así que no hay cifra
    // honesta que poner. Se dice qué hace la opción sin inventar un número.
    detalle: (n) =>
      n === null
        ? "Se congela la lista de hoy: salen los que califiquen al guardar y nadie más."
        : `Se congela la lista de hoy: salen estos ${formatearEntero(n)} y nadie más.`,
  },
  {
    modo: "dinamica",
    titulo: "Los que califiquen de ahora en más",
    // Honesto sobre lo que existe: el modo queda guardado, pero nada vuelve a
    // resolver la audiencia después de programar. El plan es una lista fija.
    detalle: () =>
      "Queda anotado que la lista sigue abierta. Hoy nada la vuelve a evaluar después de programar: sale a los mismos que la congelada.",
  },
];

/**
 * El footgun de toda la pantalla, con su propio bloque y no como un switch
 * escondido entre los filtros.
 *
 * Elegir "dinámica" sin querer es lo que le manda una promo a la base
 * histórica entera, de a poco y durante meses, sin que nadie apriete nada.
 * Por eso las dos opciones son del mismo tamaño y las dos explican qué hacen:
 * un toggle con una sola etiqueta obliga a deducir qué es lo otro.
 */
export function SelectorModo({
  modo,
  coinciden,
  onCambiar,
}: {
  modo: ModoAudiencia;
  /**
   * Cuántos entran hoy, para que la opción congelada diga un número real.
   * `null` mientras el árbol tenga una fila sin terminar: la cifra existiría
   * pero sería mentira, y esta es la pantalla donde una cifra de más se
   * convierte en mensajes de más.
   */
  coinciden: number | null;
  onCambiar: (modo: ModoAudiencia) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="text-ink-primary pb-2.5 text-[13px] font-[650]">Quiénes entran</legend>
      <div className="grid grid-cols-2 gap-2.5">
        {OPCIONES.map((o) => {
          const activa = o.modo === modo;
          return (
            <label
              key={o.modo}
              className={cn(
                "has-[:focus-visible]:ring-ring/50 flex cursor-pointer flex-col gap-1.5 rounded-[11px] border p-3 transition-colors duration-150 has-[:focus-visible]:ring-3",
                activa
                  ? "border-ink-primary bg-surface-card"
                  : "border-line-card bg-surface-card/50 hover:border-line-control",
              )}
            >
              <input
                type="radio"
                name="modo-audiencia"
                className="sr-only"
                checked={activa}
                onChange={() => onCambiar(o.modo)}
              />
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "size-[13px] shrink-0 rounded-full border-2 transition-colors duration-150",
                    activa
                      ? "border-ink-primary bg-ink-primary ring-surface-card ring-2 ring-inset"
                      : "border-line-control",
                  )}
                />
                <span
                  className={cn(
                    "text-[12px] font-[650]",
                    activa ? "text-ink-primary" : "text-ink-dim",
                  )}
                >
                  {o.titulo}
                </span>
              </span>
              <span className="text-ink-faint text-[11px] leading-relaxed">
                {o.detalle(coinciden)}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
