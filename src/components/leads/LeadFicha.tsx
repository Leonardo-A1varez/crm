import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { Badge } from "@/components/ui/badge";
import type { Lead } from "@/types/entities";
import type { LeadTagView } from "@/types/leads";

/**
 * Ficha completa del lead: información personal, vehículo, canales, tags asignados.
 * Server component (datos estáticos).
 */
export function LeadFicha({ lead, tags }: { lead: Lead; tags: LeadTagView[] }) {
  const vehiculoFull = [lead.vehiculo_marca, lead.vehiculo_modelo, lead.vehiculo_anio || ""]
    .filter(Boolean)
    .join(" ")
    .trim();

  const canales = [lead.canal_origen];
  for (const canal of ["wa", "ig", "fb"] as const) {
    if (lead.meta_user_ids[canal] && !canales.includes(canal)) {
      canales.push(canal);
    }
  }

  return (
    <div className="border-border bg-card flex flex-col gap-6 rounded-lg border p-6">
      {/* Nombre y canal origen */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-xl font-semibold">{lead.nombre}</h2>
          {canales.length > 0 ? (
            <ChannelIcons activos={canales} activoActual={lead.canal_origen} />
          ) : null}
        </div>
      </div>

      {/* Información de contacto */}
      <div className="space-y-2">
        <div>
          <p className="text-muted-foreground text-xs font-medium">Teléfono</p>
          <p className="font-mono text-sm">{lead.telefono}</p>
        </div>
        {lead.email ? (
          <div>
            <p className="text-muted-foreground text-xs font-medium">Email</p>
            <p className="text-sm">{lead.email}</p>
          </div>
        ) : null}
        {lead.direccion ? (
          <div>
            <p className="text-muted-foreground text-xs font-medium">Dirección</p>
            <p className="text-sm">{lead.direccion}</p>
          </div>
        ) : null}
      </div>

      {/* Vehículo */}
      {vehiculoFull ? (
        <div>
          <p className="text-muted-foreground text-xs font-medium">Vehículo</p>
          <p className="text-sm">{vehiculoFull}</p>
          {lead.vehiculo_motor ? (
            <p className="text-muted-foreground text-xs">Motor: {lead.vehiculo_motor}</p>
          ) : null}
        </div>
      ) : null}

      {/* Tags */}
      {tags.length > 0 ? (
        <div>
          <p className="text-muted-foreground text-xs font-medium">Tags</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <Badge
                key={t.id}
                style={{ backgroundColor: t.color, color: "white" }}
                className="text-xs"
              >
                {t.nombre}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {/* Fechas de creación y última actividad */}
      <div className="border-border border-t pt-4">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="text-muted-foreground">Creado</p>
            <p className="font-medium">
              {new Date(lead.created_at).toLocaleDateString("es-AR", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Última actividad</p>
            <p className="font-medium">
              {new Date(lead.updated_at).toLocaleDateString("es-AR", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
