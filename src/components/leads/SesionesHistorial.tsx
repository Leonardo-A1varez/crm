import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { LeadSession, UUID } from "@/types/entities";

/**
 * Historial de sesiones del lead (todas, ordenadas por started_at DESC).
 * Muestra: stage final, badge resultado, motivo si perdido, fechas.
 * Server component (datos estáticos).
 */
export function SesionesHistorial({
  sesiones,
  sesionActivaId,
  leadId,
}: {
  sesiones: LeadSession[];
  sesionActivaId: UUID | null;
  leadId: UUID;
}) {
  if (sesiones.length === 0) {
    return (
      <div className="border-border bg-card rounded-lg border p-6">
        <p className="text-muted-foreground text-sm">Sin sesiones todavía</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sesiones.map((session) => {
        const isActiva = session.resultado === null;
        const isSesionActivaActual = sesionActivaId && session.id === sesionActivaId;

        return (
          <div
            key={session.id}
            className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {/* Stage badge */}
                <Badge variant="outline" className="text-xs">
                  {session.current_stage === "nuevo"
                    ? "Nuevo"
                    : session.current_stage === "identificando"
                      ? "Identificando"
                      : session.current_stage === "cotizado"
                        ? "Cotizado"
                        : session.current_stage === "negociando"
                          ? "Negociando"
                          : session.current_stage === "esperando_pago"
                            ? "Esperando pago"
                            : session.current_stage === "cerrado"
                              ? "Cerrado"
                              : session.current_stage === "perdido"
                                ? "Perdido"
                                : "Requiere humano"}
                </Badge>

                {/* Resultado badge */}
                {isActiva ? (
                  <Badge className="bg-blue-500 text-xs">Activa</Badge>
                ) : session.resultado === "exito" ? (
                  <Badge className="bg-green-500 text-xs">Éxito</Badge>
                ) : session.resultado === "perdido" ? (
                  <Badge className="bg-red-500 text-xs">Perdido</Badge>
                ) : null}
              </div>

              {/* Link a inbox si es sesión activa */}
              {isSesionActivaActual ? (
                <Link
                  href={`/inbox/${leadId}`}
                  className="border-border hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium transition-colors"
                >
                  Abrir conversación
                </Link>
              ) : null}
            </div>

            {/* Motivo de pérdida si aplica */}
            {!isActiva && session.resultado === "perdido" && session.motivo_perdida ? (
              <div className="text-muted-foreground text-sm">
                <p className="font-medium">Motivo:</p>
                <p>{session.motivo_perdida}</p>
              </div>
            ) : null}

            {/* Fechas */}
            <div className="text-muted-foreground flex flex-col gap-1 text-xs">
              <p>
                <span className="font-medium">Inicio:</span>{" "}
                {new Date(session.started_at).toLocaleDateString("es-AR", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              {session.closed_at ? (
                <p>
                  <span className="font-medium">Cierre:</span>{" "}
                  {new Date(session.closed_at).toLocaleDateString("es-AR", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
