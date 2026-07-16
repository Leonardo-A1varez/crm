import Link from "next/link";
import { Users } from "lucide-react";
import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { EmptyState } from "@/components/shared/EmptyState";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeadListItem } from "@/types/leads";

export function LeadsTable({ items, q }: { items: LeadListItem[]; q?: string }) {
  if (items.length === 0) {
    return q ? (
      <EmptyState
        title={`Sin resultados para «${q}»`}
        description="Probá con otro nombre o teléfono."
      />
    ) : (
      <EmptyState
        icon={<Users className="h-10 w-10" />}
        title="Sin leads todavía"
        description="Los leads se crean solos cuando un cliente escribe por WhatsApp, Instagram o Messenger."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Teléfono</TableHead>
          <TableHead>Canales</TableHead>
          <TableHead>Vehículo</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="text-right">Actividad</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((l) => (
          <TableRow key={l.leadId}>
            <TableCell>
              <Link href={`/leads/${l.leadId}`} className="font-medium hover:underline">
                {l.nombre}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-xs">{l.telefono}</TableCell>
            <TableCell>
              <ChannelIcons activos={l.canales} activoActual={l.canalOrigen} />
            </TableCell>
            <TableCell className="text-muted-foreground">{l.vehiculo || "—"}</TableCell>
            <TableCell>
              {l.sesionActiva ? (
                <Badge>Sesión activa</Badge>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground text-right text-xs">
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
