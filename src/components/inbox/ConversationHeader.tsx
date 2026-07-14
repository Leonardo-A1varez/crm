import { Badge } from "@/components/ui/badge";
import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { StageBadge } from "@/components/lead-twin/StageBadge";
import { RelativeTime } from "@/components/shared/RelativeTime";
import type { Canal } from "@/types/domain";
import type { Lead, LeadSession } from "@/types/entities";

/**
 * Header de conversación: nombre + canales + stage + última actividad.
 * `actions` = slot para HandoffToggle + CloseSessionButton (client comps
 * montados desde el RSC page, que es quien importa las Server Actions).
 */
export function ConversationHeader({
  lead,
  session,
  canales,
  canalActivo,
  ultimaActividadIso,
  actions,
}: {
  lead: Lead;
  session: LeadSession | null;
  canales: Canal[];
  canalActivo: Canal;
  ultimaActividadIso: string | null;
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-border flex items-center gap-3 border-b px-4 py-3">
      <ChannelIcons activos={canales} activoActual={canalActivo} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-base font-semibold">{lead.nombre}</h1>
          {session ? (
            <StageBadge stage={session.current_stage} />
          ) : (
            <Badge variant="outline" className="text-xs">
              Sin sesión activa
            </Badge>
          )}
          {session?.ia_pausada ? (
            <Badge variant="outline" className="text-xs">
              IA pausada
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground truncate text-xs">
          {lead.telefono}
          {ultimaActividadIso ? (
            <>
              {" · última actividad "}
              <RelativeTime iso={ultimaActividadIso} />
            </>
          ) : null}
        </p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
