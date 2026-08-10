import Link from "next/link";
import { Group } from "@/components/icons";
import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { EmptyState } from "@/components/shared/EmptyState";
import { RelativeTime } from "@/components/shared/RelativeTime";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeadListItem } from "@/types/leads";

const TH =
  "text-ink-faint px-5 py-2.5 font-mono text-[9px] font-semibold tracking-[0.13em] uppercase";
const TD = "px-5 py-[9px]";

export function LeadsTable({ items, q }: { items: LeadListItem[]; q?: string }) {
  if (items.length === 0) {
    return q ? (
      <EmptyState
        title={`Sin resultados para «${q}»`}
        description="Probá con otro nombre o teléfono."
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
    <Table className="text-[12.5px]">
      <TableHeader>
        <TableRow className="border-line-layout hover:bg-transparent">
          <TableHead className={TH}>Nombre</TableHead>
          <TableHead className={TH}>Teléfono</TableHead>
          <TableHead className={TH}>Canales</TableHead>
          <TableHead className={TH}>Vehículo</TableHead>
          <TableHead className={TH}>Estado</TableHead>
          <TableHead className={`${TH} text-right`}>Actividad</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((l) => (
          <TableRow key={l.leadId} className="border-line-layout hover:bg-surface-elevated">
            <TableCell className={TD}>
              <Link
                href={`/leads/${l.leadId}`}
                className="text-ink-primary font-semibold hover:underline"
              >
                {l.nombre}
              </Link>
            </TableCell>
            <TableCell className={`${TD} text-ink-dim font-mono text-[11px]`}>
              {l.telefono}
            </TableCell>
            <TableCell className={TD}>
              <ChannelIcons activos={l.canales} activoActual={l.canalOrigen} />
            </TableCell>
            <TableCell className={`${TD} text-ink-dim`}>{l.vehiculo || "—"}</TableCell>
            <TableCell className={TD}>
              {l.sesionActiva ? (
                <span className="text-ok bg-ok/10 border-ok/28 inline-flex items-center gap-1.5 rounded-md border px-[7px] py-[2.5px] text-[10px] font-semibold">
                  <span aria-hidden className="bg-ok animate-pulse-dot h-1.5 w-1.5 rounded-full" />
                  Sesión activa
                </span>
              ) : (
                <span className="text-ink-ghost">—</span>
              )}
            </TableCell>
            <TableCell className={`${TD} text-ink-faint text-right font-mono text-[10px]`}>
              <RelativeTime
                iso={l.updatedAt instanceof Date ? l.updatedAt.toISOString() : l.updatedAt}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
