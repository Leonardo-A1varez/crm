import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const PASOS_DIFUSION = ["Audiencia", "Mensaje", "Pre-vuelo"] as const;
export type PasoDifusion = (typeof PASOS_DIFUSION)[number];

/**
 * Los tres pasos de armado. Numerados porque acá el orden SÍ es información:
 * no se puede estimar el costo sin saber a quién le llega, ni revisar el
 * pre-vuelo sin el mensaje. Un numerador decorativo en una lista que no es
 * secuencia sería ruido; esta lo es.
 */
export function PasosDifusion({ actual }: { actual: PasoDifusion }) {
  return (
    <ol className="flex shrink-0 items-center gap-1.5">
      {PASOS_DIFUSION.map((paso, i) => {
        const activo = paso === actual;
        const hecho = PASOS_DIFUSION.indexOf(actual) > i;
        return (
          <li key={paso} className="flex items-center gap-1.5">
            {i > 0 ? (
              <span className="text-line-control text-[11px]" aria-hidden>
                →
              </span>
            ) : null}
            <span
              aria-current={activo ? "step" : undefined}
              className={cn(
                "rounded-[7px] px-2.5 py-1 text-[11.5px] whitespace-nowrap",
                activo
                  ? "bg-ink-primary text-surface-panel font-semibold"
                  : hecho
                    ? "bg-surface-input text-ink-secondary font-medium"
                    : "text-ink-faint font-medium",
              )}
            >
              <span className="font-mono tabular-nums">{i + 1}</span> · {paso}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Barra superior de las pantallas de armado: volver, nombre de la campaña,
 * en qué paso estás y la acción que avanza.
 */
export function CabeceraDifusion({
  nombre,
  paso,
  onVolver,
  etiquetaVolver,
  acciones,
}: {
  nombre: string;
  paso: PasoDifusion;
  onVolver: () => void;
  etiquetaVolver: string;
  acciones?: ReactNode;
}) {
  return (
    <header className="border-line-layout bg-surface-panel flex h-[52px] shrink-0 items-center gap-3 border-b px-4">
      <Button variant="outline" size="sm" onClick={onVolver} className="shrink-0">
        <span aria-hidden>←</span>
        {etiquetaVolver}
      </Button>
      <h1 className="text-ink-primary shrink-0 truncate text-[14px] font-[650] tracking-[-0.01em]">
        {nombre}
      </h1>
      <PasosDifusion actual={paso} />
      {acciones ? <div className="ml-auto flex shrink-0 items-center gap-2">{acciones}</div> : null}
    </header>
  );
}
