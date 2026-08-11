import { MonoMeta } from "@/components/shared/MonoMeta";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { StageBadge } from "@/components/shared/StageBadge";
import { motivoPerdidaLabel } from "@/lib/ui/motivo-perdida";
import type { LeadSession } from "@/types/entities";

const CHIP =
  "inline-flex items-center rounded-md border px-[7px] py-[2.5px] text-[10px] font-semibold";

/**
 * Historial de sesiones del lead (todas, orden started_at DESC del repo).
 * Server component (datos estáticos).
 */
export function SesionesHistorial({ sesiones }: { sesiones: LeadSession[] }) {
  if (sesiones.length === 0) {
    return <p className="text-ink-faint px-5 py-6 text-[11.5px]">Sin sesiones registradas.</p>;
  }
  return (
    <ul className="divide-line-layout divide-y">
      {sesiones.map((s) => (
        <li key={s.id} className="flex items-center gap-2.5 px-5 py-[11px]">
          <StageBadge stage={s.current_stage} />
          {s.resultado === null ? (
            <span className={`${CHIP} text-ok bg-ok/10 border-ok/28`}>Activa</span>
          ) : s.resultado === "exito" ? (
            <span className={`${CHIP} text-ok bg-ok/10 border-ok/28`}>Éxito</span>
          ) : (
            <span className={`${CHIP} text-danger bg-danger/10 border-danger/28`}>Perdido</span>
          )}
          {s.motivo_perdida ? (
            <span className="text-ink-dim text-[11.5px]">
              {motivoPerdidaLabel(s.motivo_perdida)}
            </span>
          ) : null}
          <MonoMeta className="ml-auto">
            <RelativeTime iso={s.started_at.toISOString()} />
            {s.closed_at ? (
              <>
                {" · cerrada "}
                <RelativeTime iso={s.closed_at.toISOString()} />
              </>
            ) : null}
          </MonoMeta>
        </li>
      ))}
    </ul>
  );
}
