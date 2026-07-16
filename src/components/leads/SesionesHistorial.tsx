import { StageBadge } from "@/components/lead-twin/StageBadge";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { Badge } from "@/components/ui/badge";
import type { LeadSession } from "@/types/entities";

const MOTIVO_LABEL: Record<string, string> = {
  precio: "Precio",
  stock: "Sin stock",
  tiempo: "Tiempos de entrega",
  no_responde: "No responde",
  otro: "Otro",
};

/**
 * Historial de sesiones del lead (todas, orden started_at DESC del repo).
 * Server component (datos estáticos).
 */
export function SesionesHistorial({ sesiones }: { sesiones: LeadSession[] }) {
  if (sesiones.length === 0) {
    return <p className="text-muted-foreground px-4 py-6 text-sm">Sin sesiones registradas.</p>;
  }
  return (
    <ul className="divide-border divide-y">
      {sesiones.map((s) => (
        <li key={s.id} className="flex items-center gap-3 px-4 py-3">
          <StageBadge stage={s.current_stage} />
          {s.resultado === null ? (
            <Badge>Activa</Badge>
          ) : (
            <Badge variant={s.resultado === "exito" ? "default" : "outline"}>
              {s.resultado === "exito" ? "Éxito" : "Perdido"}
            </Badge>
          )}
          {s.motivo_perdida ? (
            <span className="text-muted-foreground text-xs">
              {MOTIVO_LABEL[s.motivo_perdida] ?? s.motivo_perdida}
            </span>
          ) : null}
          <span className="text-muted-foreground ml-auto text-xs">
            <RelativeTime iso={s.started_at.toISOString()} />
            {s.closed_at ? (
              <>
                {" "}
                · cerrada <RelativeTime iso={s.closed_at.toISOString()} />
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
