import Link from "next/link";
import { AutoAwesome } from "@/components/icons";
import { cantidad, formatearUsd } from "@/lib/ui/metricas";
import type { IntentSinRegla } from "@/types/metricas";

const FECHA = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });

/**
 * Los intents que hoy contesta el LLM porque nadie les escribió una regla
 * (handoff §3.2), con lo que cuesta cada uno por día.
 *
 * El costo diario reparte gasto real, no un contrafáctico: estos turnos SÍ
 * pasaron por el modelo. Lo aproximado es el reparto —se usa el costo promedio
 * de un turno del agente, porque `llm_usage` guarda el gasto por turno y no por
 * intent—, así que un intent con turnos más largos que la media queda
 * subestimado y uno con turnos cortos, sobreestimado.
 */
export function IntentsSinRegla({
  intents,
  promedioTurnoUsd,
  dias,
}: {
  intents: IntentSinRegla[];
  /** Costo promedio de un turno del agente. `null` = no hay con qué estimar. */
  promedioTurnoUsd: number | null;
  dias: number;
}) {
  if (intents.length === 0) {
    return (
      <p className="text-ink-faint text-[11.5px]">
        Todos los intents activos tienen una regla: el LLM solo entra en lo que ninguno cubre.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {intents.map((i) => (
        <li
          key={i.id}
          className="border-line-layout flex items-start gap-2.5 border-b pb-2.5 last:border-0 last:pb-0"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-ink-secondary truncate font-mono text-[11.5px]">
                {i.nombre}
              </span>
              {i.autoDetectado ? (
                <span
                  className="flex shrink-0 items-center gap-0.5 rounded-[5px] px-1.5 py-px font-mono text-[9px] font-semibold tracking-[0.06em] uppercase"
                  style={{
                    color: "var(--color-brand)",
                    backgroundColor: "color-mix(in srgb, var(--color-brand) 13%, transparent)",
                  }}
                  title="Lo propuso el detector mirando conversaciones reales"
                >
                  <AutoAwesome size={9} aria-hidden />
                  detectado
                </span>
              ) : null}
            </div>
            {i.descripcion ? (
              <p className="text-ink-faint mt-0.5 line-clamp-2 text-[10.5px]">{i.descripcion}</p>
            ) : null}
            {i.usos > 0 ? (
              <p className="text-ink-ghost mt-1 font-mono text-[9.5px] tabular-nums">
                {cantidad(i.usos, "turno")}
                {promedioTurnoUsd !== null && dias > 0
                  ? ` · ${formatearUsd((i.usos * promedioTurnoUsd) / dias)}/día`
                  : ""}
              </p>
            ) : null}
          </div>
          <span className="text-ink-ghost shrink-0 font-mono text-[10px] tabular-nums">
            {FECHA.format(i.detectadoEl)}
          </span>
          <Link
            href="/agente?tab=reglas"
            className="border-line-control text-ink-dim hover:border-brand hover:text-ink-primary shrink-0 rounded-[8px] border px-2 py-[3px] text-[10.5px] font-medium transition-colors"
          >
            Escribir regla
          </Link>
        </li>
      ))}
    </ul>
  );
}
