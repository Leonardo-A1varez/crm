import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { LeadFicha } from "@/components/leads/LeadFicha";
import { SesionesHistorial } from "@/components/leads/SesionesHistorial";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const svc = await getLeadsServiceForRequest();
  let detail;
  try {
    detail = await svc.getLeadDetail(id);
  } catch (e) {
    if (e instanceof NotFoundError) {
      notFound();
    }
    throw e;
  }

  const { lead, tags, sesiones, sesionActiva, duplicados } = detail;

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">{lead.nombre}</h1>
          <p className="text-muted-foreground text-xs">
            {lead.telefono} · {lead.canal_origen.toUpperCase()}
          </p>
        </div>
        <Link href="/leads" className="text-muted-foreground text-sm hover:underline">
          ← Volver a leads
        </Link>
      </header>

      {/* Contenido: 2 columnas en desktop */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-3">
          {/* Columna izquierda: Ficha + sesiones */}
          <div className="space-y-6 lg:col-span-2">
            <LeadFicha lead={lead} tags={tags} />
            <SesionesHistorial
              sesiones={sesiones}
              sesionActivaId={sesionActiva?.id ?? null}
              leadId={lead.id}
            />
          </div>

          {/* Columna derecha: Duplicados pendientes */}
          <div className="space-y-4">
            {duplicados.length > 0 ? (
              <div className="space-y-3">
                <h3 className="font-semibold">Duplicados pendientes</h3>
                {duplicados.map((dup) => (
                  <div
                    key={dup.candidateId}
                    className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/30 dark:bg-amber-950/20"
                  >
                    <div className="mb-2 flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                      <div className="flex-1">
                        <p className="font-medium text-amber-950 dark:text-amber-100">
                          {dup.otherLead.nombre}
                        </p>
                        <p className="font-mono text-xs text-amber-900 dark:text-amber-300">
                          {dup.otherLead.telefono}
                        </p>
                      </div>
                    </div>

                    {/* Vehículo del otro lead */}
                    {dup.otherLead.vehiculo_marca ? (
                      <p className="text-xs text-amber-900 dark:text-amber-300">
                        {[
                          dup.otherLead.vehiculo_marca,
                          dup.otherLead.vehiculo_modelo,
                          dup.otherLead.vehiculo_anio || "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      </p>
                    ) : null}

                    {/* Score y motivos */}
                    <div className="mt-2 text-xs text-amber-900 dark:text-amber-300">
                      <p>
                        <span className="font-medium">Similitud:</span>{" "}
                        {(dup.score * 100).toFixed(0)}%
                      </p>
                      {dup.reasons.length > 0 ? (
                        <p className="text-amber-800 dark:text-amber-200">
                          <span className="font-medium">Razones:</span> {dup.reasons.join(", ")}
                        </p>
                      ) : null}
                    </div>

                    {/* Fecha de creación del candidate */}
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      Detectado{" "}
                      {new Date(dup.createdAt).toLocaleDateString("es-AR", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>

                    {/* Acciones: Aprobar / Rechazar (admin only — UI deshabilitada para vendedor) */}
                    {/* TODO: Acciones de merge (10.D) */}
                  </div>
                ))}
              </div>
            ) : null}

            {/* Botón "Marcar duplicado de..." (admin only) */}
            {/* TODO: Dialog para marcar duplicado manual (10.D) */}
          </div>
        </div>
      </div>
    </div>
  );
}
