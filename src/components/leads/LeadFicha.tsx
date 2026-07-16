import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { Badge } from "@/components/ui/badge";
import type { Lead } from "@/types/entities";
import type { LeadTagView } from "@/types/leads";

function Campo({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value?.trim() ? value : "—"}</span>
    </div>
  );
}

/**
 * Ficha del lead: contacto + vehículo + tags. Server component (datos estáticos).
 */
export function LeadFicha({ lead, tags }: { lead: Lead; tags: LeadTagView[] }) {
  const vehiculo = [lead.vehiculo_marca, lead.vehiculo_modelo, lead.vehiculo_anio || ""]
    .map(String)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

  // Canal origen + canales vinculados con meta_user_ids presente (dedup).
  const canales = [lead.canal_origen];
  for (const canal of ["wa", "ig", "fb"] as const) {
    if (lead.meta_user_ids[canal] && !canales.includes(canal)) {
      canales.push(canal);
    }
  }

  return (
    <section className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">{lead.nombre}</h2>
        <ChannelIcons activos={canales} activoActual={lead.canal_origen} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Campo label="Teléfono" value={lead.telefono} />
        <Campo label="Email" value={lead.email} />
        <Campo label="Dirección" value={lead.direccion} />
        <Campo label="Vehículo" value={vehiculo || null} />
        <Campo label="Motor" value={lead.vehiculo_motor} />
      </div>
      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <Badge key={t.id} variant="outline" style={{ borderColor: t.color, color: t.color }}>
              {t.nombre}
            </Badge>
          ))}
        </div>
      ) : null}
    </section>
  );
}
