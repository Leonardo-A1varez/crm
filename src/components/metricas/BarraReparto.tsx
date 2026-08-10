import { formatearEntero, formatearPorcentaje, porcentajeDe } from "@/lib/ui/metricas";

export interface Parte {
  label: string;
  cantidad: number;
  color: string;
  /** Nota al pie de la parte, cuando el conteo solo no se explica. */
  detalle?: string;
}

/**
 * Barra apilada con leyenda, para los repartos de dos o tres partes del handoff
 * (§3.1 "quién cerró la venta", §3.2 "cómo resolvió cada turno"). El vacío se
 * dice con palabras y no con una barra en cero, que se leería como un dato.
 */
export function BarraReparto({ partes, vacio }: { partes: Parte[]; vacio: string }) {
  const total = partes.reduce((acc, p) => acc + p.cantidad, 0);

  if (total === 0) {
    return <p className="text-ink-faint text-[11.5px]">{vacio}</p>;
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="bg-surface-input flex h-[9px] overflow-hidden rounded-full">
        {partes.map((p) => (
          <div
            key={p.label}
            style={{ width: `${porcentajeDe(p.cantidad, total)}%`, backgroundColor: p.color }}
            aria-hidden
          />
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {partes.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span
              className="size-[7px] shrink-0 rounded-full"
              style={{ backgroundColor: p.color }}
              aria-hidden
            />
            <span className="text-ink-dim min-w-0 flex-1 truncate text-[11.5px]">
              {p.label}
              {p.detalle ? <span className="text-ink-ghost"> · {p.detalle}</span> : null}
            </span>
            <span className="text-ink-secondary shrink-0 font-mono text-[11.5px] tabular-nums">
              {formatearPorcentaje(porcentajeDe(p.cantidad, total))}
            </span>
            <span className="text-ink-faint w-14 shrink-0 text-right font-mono text-[10.5px] tabular-nums">
              {formatearEntero(p.cantidad)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
