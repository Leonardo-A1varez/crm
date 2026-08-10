import { ChannelDot } from "@/components/shared/ChannelDot";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { StageBadge } from "@/components/shared/StageBadge";
import { canalLabel } from "@/lib/ui/canal";
import type { Canal } from "@/types/domain";
import type { Lead, LeadSession } from "@/types/entities";

/**
 * Separador de la línea de meta. Tiene token propio y más oscuro que cualquier
 * `ink-*` a propósito: es puntuación, y no tiene que competir con los datos que
 * separa.
 */
function Separador() {
  return <span className="text-line-dot"> · </span>;
}

/**
 * Header de conversación: avatar + nombre + stage + meta (teléfono, canales,
 * última actividad). `actions` = slot para HandoffToggle + CloseSessionButton
 * (client comps montados desde el RSC page, que es quien importa las Server
 * Actions).
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
    <header className="border-line-layout bg-surface-chat/86 flex items-center gap-3 border-b px-5 py-[13px] backdrop-blur-[8px]">
      <div className="relative shrink-0">
        <InitialsAvatar nombre={lead.nombre} size={36} />
        <ChannelDot
          canal={canalActivo}
          size={13}
          ringColor="var(--color-surface-chat)"
          className="absolute right-[-2px] bottom-[-2px]"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="text-ink-primary truncate text-[14.5px] font-[650] tracking-[-0.015em]">
            {lead.nombre}
          </h1>
          {session ? (
            <StageBadge stage={session.current_stage} />
          ) : (
            <span className="text-ink-fainter bg-surface-elevated inline-flex shrink-0 items-center rounded-md px-[7px] py-[2.5px] text-[10px] font-semibold">
              Sin sesión activa
            </span>
          )}
        </div>
        {/* Teléfono · canales · última actividad, en una sola línea mono. */}
        <MonoMeta className="mt-0.5 block truncate text-[10.5px]">
          {lead.telefono}
          <Separador />
          {canales.map(canalLabel).join(", ")}
          {ultimaActividadIso ? (
            <>
              <Separador />
              últ. actividad <RelativeTime iso={ultimaActividadIso} />
            </>
          ) : null}
        </MonoMeta>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
