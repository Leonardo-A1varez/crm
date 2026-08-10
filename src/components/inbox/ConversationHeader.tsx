import { CanalGlyph } from "@/components/inbox/ChannelIcons";
import { ChannelDot } from "@/components/shared/ChannelDot";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { StageBadge } from "@/components/shared/StageBadge";
import { canalColor, canalLabel } from "@/lib/ui/canal";
import { nombreVisible, sinNombre } from "@/lib/ui/lead";
import type { Canal } from "@/types/domain";
import type { Lead, LeadSession } from "@/types/entities";

/**
 * Header de conversación: avatar + nombre + stage + acciones.
 *
 * La línea de meta (teléfono · canales · última actividad) se fue al Twin: acá
 * vivía en una sola línea que se truncaba apenas el nombre era largo, y el
 * Twin tiene los 322px y el scroll para mostrarla entera. `actions` = slot para
 * HandoffToggle + CloseSessionButton (client comps montados desde el RSC page,
 * que es quien importa las Server Actions).
 */
export function ConversationHeader({
  lead,
  session,
  canalActivo,
  actions,
}: {
  lead: Lead;
  session: LeadSession | null;
  canalActivo: Canal;
  actions?: React.ReactNode;
}) {
  // En el header no hay lugar para invitar a ponerle nombre —esa invitación es
  // del Twin—, así que acá el hueco se nombra y se atenúa.
  const anonimo = sinNombre(lead.nombre);

  // Los canales salen de la entidad y no de la vista: `canal_origen` mas los
  // que tengan id de Meta. Se muestran con su glifo y su nombre, sin rotulo
  // "Canal" delante — el glifo ya dice de que se trata.
  const canales: Canal[] = [lead.canal_origen];
  for (const c of ["wa", "ig", "fb"] as const) {
    if (lead.meta_user_ids[c] && !canales.includes(c)) canales.push(c);
  }

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
        <div className="flex min-w-0 items-center gap-2">
          <h1
            className={`truncate text-[14.5px] font-[650] tracking-[-0.015em] ${
              anonimo ? "text-ink-faint" : "text-ink-primary"
            }`}
          >
            {nombreVisible(lead.nombre)}
          </h1>
          {session ? (
            <StageBadge stage={session.current_stage} />
          ) : (
            <span className="text-ink-fainter bg-surface-elevated inline-flex shrink-0 items-center rounded-md px-[7px] py-[2.5px] text-[10px] font-semibold">
              Sin sesión activa
            </span>
          )}
        </div>
        <div className="mt-[3px] flex items-center gap-2.5">
          {canales.map((c) => (
            <span key={c} className="flex items-center gap-1" style={{ color: canalColor(c) }}>
              <CanalGlyph canal={c} className="h-[13px] w-[13px]" />
              <span className="text-[10.5px] font-medium">{canalLabel(c)}</span>
            </span>
          ))}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
