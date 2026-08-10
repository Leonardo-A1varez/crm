import { formatearPorcentaje, porcentajeDe } from "@/lib/ui/metricas";
import { stageColor, stageLabel } from "@/lib/ui/stage";
import type { ConteoEtapa } from "@/types/metricas";

/**
 * Embudo del handoff §3.1: barra de 22px por etapa. El ancho es la proporción
 * real sobre el total, no una escala contra el máximo del corte, para que la
 * barra y el porcentaje impreso al lado digan lo mismo. Una etapa con pocas
 * sesiones igual deja un resto visible en vez de desaparecer, que es lo único
 * que la escala contra el máximo resolvía.
 */
function Fila({ fila, total }: { fila: ConteoEtapa; total: number }) {
  const pct = porcentajeDe(fila.cantidad, total);
  const color = stageColor(fila.stage);

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-ink-dim w-[112px] shrink-0 truncate text-[11.5px] font-medium">
        {stageLabel(fila.stage)}
      </span>
      <div className="bg-surface-input h-[22px] min-w-0 flex-1 overflow-hidden rounded-[6px]">
        <div
          className="h-full rounded-[6px]"
          style={{
            width: `${pct}%`,
            minWidth: fila.cantidad > 0 ? 3 : 0,
            backgroundColor: color,
            opacity: 0.85,
          }}
          aria-hidden
        />
      </div>
      <span className="text-ink-secondary w-9 shrink-0 text-right font-mono text-[11.5px] tabular-nums">
        {fila.cantidad}
      </span>
      <span className="text-ink-faint w-12 shrink-0 text-right font-mono text-[10.5px] tabular-nums">
        {formatearPorcentaje(pct)}
      </span>
    </div>
  );
}

export function EmbudoEtapas({ filas, total }: { filas: ConteoEtapa[]; total: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {filas.map((f) => (
        <Fila key={f.stage} fila={f} total={total} />
      ))}
    </div>
  );
}
