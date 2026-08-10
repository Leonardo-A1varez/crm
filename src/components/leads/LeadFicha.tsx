import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { formatearTelefono } from "@/lib/ui/telefono";
import type { Lead } from "@/types/entities";
import type { LeadTagView } from "@/types/leads";

function Campo({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="text-ink-faint text-[10.5px]">{label}</span>
      <span className="text-ink-secondary text-[12.5px]">{value?.trim() ? value : "—"}</span>
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
    <section className="flex flex-col gap-4 px-5 py-[18px]">
      <div className="flex items-center gap-3">
        <InitialsAvatar nombre={lead.nombre} size={38} />
        <div className="min-w-0">
          <h2 className="text-ink-primary truncate text-[18px] font-[680] tracking-[-0.02em]">
            {lead.nombre}
          </h2>
          <div className="mt-1">
            <ChannelIcons activos={canales} activoActual={lead.canal_origen} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 lg:grid-cols-3">
        <Campo label="Teléfono" value={formatearTelefono(lead.telefono)} />
        <Campo label="Email" value={lead.email} />
        <Campo label="Dirección" value={lead.direccion} />
        <Campo label="Vehículo" value={vehiculo || null} />
        <Campo label="Motor" value={lead.vehiculo_motor} />
      </div>
      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center rounded-md border px-[7px] py-[2.5px] text-[10px] font-semibold"
              style={{ borderColor: t.color, color: t.color }}
            >
              {t.nombre}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
