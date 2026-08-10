import { ChannelDot } from "@/components/shared/ChannelDot";
import { canalColor, canalLabel } from "@/lib/ui/canal";
import { formatearEntero, formatearPorcentaje, porcentajeDe } from "@/lib/ui/metricas";
import type { ConteoCanal } from "@/types/metricas";

/** Volumen por canal del handoff §3.1: barra apilada de 9px + leyenda. */
export function VolumenCanal({ filas }: { filas: ConteoCanal[] }) {
  const total = filas.reduce((acc, f) => acc + f.cantidad, 0);

  if (total === 0) {
    return <p className="text-ink-faint text-[11.5px]">Sin mensajes en el período.</p>;
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="bg-surface-input flex h-[9px] overflow-hidden rounded-full">
        {filas.map((f) => (
          <div
            key={f.canal}
            style={{
              width: `${porcentajeDe(f.cantidad, total)}%`,
              backgroundColor: canalColor(f.canal),
            }}
            aria-hidden
          />
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {filas.map((f) => (
          <li key={f.canal} className="flex items-center gap-2">
            <ChannelDot canal={f.canal} size={7} />
            <span className="text-ink-dim min-w-0 flex-1 truncate text-[11.5px]">
              {canalLabel(f.canal)}
            </span>
            <span className="text-ink-secondary shrink-0 font-mono text-[11.5px] tabular-nums">
              {formatearPorcentaje(porcentajeDe(f.cantidad, total))}
            </span>
            <span className="text-ink-faint w-14 shrink-0 text-right font-mono text-[10.5px] tabular-nums">
              {formatearEntero(f.cantidad)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
