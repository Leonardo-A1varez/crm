import { formatearEntero } from "@/lib/ui/metricas";

export interface FilaTopLista {
  label: string;
  /** Texto secundario opcional, en Geist Mono chico (ej: "3 unidades"). */
  meta?: string;
  valor: number;
}

/** Lista compacta label + meta opcional + conteo, para los "top N" de Métricas. */
export function TopLista({ filas, vacio }: { filas: FilaTopLista[]; vacio: string }) {
  if (filas.length === 0) {
    return <p className="text-ink-faint text-[11.5px]">{vacio}</p>;
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {filas.map((f) => (
        <li key={f.label} className="flex items-center gap-2">
          <span className="text-ink-dim min-w-0 flex-1 truncate font-mono text-[11px]">
            {f.label}
          </span>
          {f.meta ? (
            <span className="text-ink-ghost shrink-0 font-mono text-[9.5px]">{f.meta}</span>
          ) : null}
          <span className="text-ink-secondary w-14 shrink-0 text-right font-mono text-[11.5px] tabular-nums">
            {formatearEntero(f.valor)}
          </span>
        </li>
      ))}
    </ul>
  );
}
