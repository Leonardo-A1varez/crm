import Link from "next/link";
import { Group } from "@/components/icons";
import { ChannelDot } from "@/components/shared/ChannelDot";
import { EmptyState } from "@/components/shared/EmptyState";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { StageBadge } from "@/components/shared/StageBadge";
import { formatearTelefono } from "@/lib/ui/telefono";
import type { LeadListItem } from "@/types/leads";

// Encabezado y filas comparten la plantilla de columnas del handoff §2, así
// que vive en una sola constante: si se desincronizan, las columnas dejan de
// alinearse y el defecto es invisible leyendo el diff.
const FILA =
  "grid grid-cols-[1.5fr_1.1fr_1.4fr_0.9fr_0.8fr] items-center gap-[14px] px-[18px] py-[11px]";
const TH = "text-ink-faint font-mono text-[9px] font-semibold tracking-[0.13em] uppercase";

export function LeadsTable({
  items,
  q,
  hayFiltros = false,
}: {
  items: LeadListItem[];
  q?: string;
  /**
   * Hay chips puestos. Sin esto, filtrar hasta cero sin haber escrito nada
   * mostraría "Sin leads todavía" — que dice que la base está vacía cuando lo
   * que pasó es que el filtro no dejó pasar a nadie.
   */
  hayFiltros?: boolean;
}) {
  if (items.length === 0) {
    return q ? (
      <EmptyState
        title={`Sin resultados para «${q}»`}
        description="Probá con otro término o quitá algún filtro."
      />
    ) : hayFiltros ? (
      <EmptyState
        title="Ningún lead pasa estos filtros"
        description="Sacá alguno de los chips para ensanchar la búsqueda."
      />
    ) : (
      <EmptyState
        icon={<Group size={34} strokeWidth={1.4} />}
        title="Sin leads todavía"
        description="Los leads se crean solos cuando un cliente escribe por WhatsApp, Instagram o Messenger."
      />
    );
  }

  return (
    // Divs con roles ARIA y no `<table>`: la plantilla de columnas en `fr` del
    // handoff necesita `display:grid` en la fila, y eso descarta el layout de
    // tabla nativo. Los roles mantienen la semántica para el lector de pantalla.
    <div className="bg-surface-card border-line-card overflow-hidden rounded-[15px] border">
      <div role="table" aria-label="Leads">
        <div role="rowgroup">
          <div role="row" className={FILA}>
            <span role="columnheader" className={TH}>
              Lead
            </span>
            <span role="columnheader" className={TH}>
              Teléfono
            </span>
            <span role="columnheader" className={TH}>
              Vehículo
            </span>
            <span role="columnheader" className={TH}>
              Etapa
            </span>
            <span role="columnheader" className={`${TH} text-right`}>
              Actividad
            </span>
          </div>
        </div>

        <div role="rowgroup">
          {items.map((l) => (
            <div
              key={l.leadId}
              role="row"
              className={`${FILA} border-line-row hover:bg-line-row border-t transition-colors`}
            >
              <span role="cell" className="flex min-w-0 items-center gap-2.5">
                <span className="relative shrink-0">
                  <InitialsAvatar nombre={l.nombre} size={28} />
                  {/* El canal se lee acá y por eso ya no hay columna propia. */}
                  <ChannelDot
                    canal={l.canalOrigen}
                    size={10}
                    ringColor="var(--color-surface-card)"
                    className="absolute right-[-2px] bottom-[-2px]"
                  />
                </span>
                <Link
                  href={`/leads/${l.leadId}`}
                  className="text-ink-primary truncate text-[12.5px] font-[550] hover:underline"
                >
                  {l.nombre}
                </Link>
              </span>

              <span role="cell" className="text-ink-dim truncate font-mono text-[11px]">
                {formatearTelefono(l.telefono)}
              </span>

              <span role="cell" className="text-ink-muted truncate text-[11.5px]">
                {l.vehiculo || "—"}
              </span>

              <span role="cell" className="min-w-0">
                {l.currentStage ? (
                  <StageBadge stage={l.currentStage} />
                ) : (
                  <span className="text-ink-ghost">—</span>
                )}
              </span>

              <span role="cell" className="text-ink-faint text-right font-mono text-[10.5px]">
                <RelativeTime
                  iso={l.updatedAt instanceof Date ? l.updatedAt.toISOString() : l.updatedAt}
                />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
