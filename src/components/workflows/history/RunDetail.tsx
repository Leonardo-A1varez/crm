"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, RotateCcw, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { ESTADOS_RUN } from "./estados";
import { TimelineEjecucion } from "./TimelineEjecucion";
import type { WorkflowRunDetalle } from "./types";

interface RunDetailProps {
  run: WorkflowRunDetalle;
  onBack: () => void;
  onReejecutar?: (runId: string, nodoId: string) => void;
}

/** Formatea la fecha completa (Hoy 14:28:32) */
function formatFechaCompleta(date: Date): string {
  const ahora = new Date();
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const ayer = new Date(hoy.getTime() - 24 * 60 * 60 * 1000);

  const hora = date.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  if (date >= hoy) {
    return `Hoy ${hora}`;
  }
  if (date >= ayer) {
    return `Ayer ${hora}`;
  }
  return (
    date.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) +
    ` ${hora}`
  );
}

/** Formatea la duracion en ms a un string legible */
function formatDuracion(ms: number | null): string {
  if (ms === null) return "en curso...";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * Detalle expandido de un run con trigger, lead y timeline.
 */
export function RunDetail({ run, onBack, onReejecutar }: RunDetailProps) {
  const [copiado, setCopiado] = useState(false);
  const estadoConfig = ESTADOS_RUN[run.estado];
  const Icono = estadoConfig.icono;

  const nombreLead = run.lead_nombre || "Lead sin nombre";

  // El nodo donde fallo (para re-ejecutar)
  const nodoError = run.estado === "fallado" ? run.pasos.find((p) => p.error)?.nodo_id : null;

  const handleCopiarDebug = async () => {
    const debugData = {
      run_id: run.id,
      workflow_id: run.workflow_id,
      version_id: run.version_id,
      estado: run.estado,
      error: run.error,
      iniciado_en: run.iniciado_en.toISOString(),
      completado_en: run.completado_en?.toISOString() ?? null,
      trigger_datos: run.trigger_datos,
      pasos: run.pasos.map((p) => ({
        nodo_id: p.nodo_id,
        estado: p.estado,
        entrada: p.entrada,
        salida: p.salida,
        error: p.error,
      })),
    };
    await navigator.clipboard.writeText(JSON.stringify(debugData, null, 2));
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Encabezado con boton volver */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-ink-faint hover:text-ink-secondary transition-colors"
          aria-label="Volver"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="text-ink-secondary text-[12px] font-medium">
          Ejecucion #{run.id.slice(0, 8)}
        </span>
      </div>

      {/* Info general */}
      <div className="border-line-layout bg-surface-panel rounded-[9px] border p-3">
        <div className="mb-3 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] font-semibold",
              estadoConfig.bg,
              estadoConfig.color,
            )}
          >
            <Icono size={14} />
            {estadoConfig.label}
          </span>
        </div>

        <div className="text-ink-secondary space-y-1 text-[11px]">
          <p>
            <span className="text-ink-faint">Iniciado:</span> {formatFechaCompleta(run.iniciado_en)}
          </p>
          <p>
            <span className="text-ink-faint">Duracion:</span> {formatDuracion(run.duracion_ms)}
          </p>
          <p>
            <span className="text-ink-faint">Version:</span> v{run.version_numero}
            {run.version_actual ? " (actual)" : ""}
          </p>
        </div>
      </div>

      {/* Lead */}
      <div className="border-line-layout bg-surface-panel rounded-[9px] border p-3">
        <p className="text-ink-faint mb-1 text-[10px] font-medium tracking-wide uppercase">Lead</p>
        <p className="text-ink-primary text-[12px] font-medium">{nombreLead}</p>
        <Link
          href={`/leads/${run.lead_id}`}
          className="text-ink-faint hover:text-ink-secondary mt-1 inline-flex items-center gap-1 text-[11px] transition-colors"
        >
          Ver lead <ExternalLink size={10} />
        </Link>
      </div>

      {/* Trigger */}
      <div className="border-line-layout bg-surface-panel rounded-[9px] border p-3">
        <p className="text-ink-faint mb-1 text-[10px] font-medium tracking-wide uppercase">
          Trigger
        </p>
        <p className="text-ink-primary text-[12px] font-medium">{run.trigger_tipo}</p>
        {Object.keys(run.trigger_datos).length > 0 && (
          <pre className="bg-surface-hover text-ink-secondary mt-2 max-h-[100px] overflow-auto rounded-md p-2 text-[10px]">
            {JSON.stringify(run.trigger_datos, null, 2)}
          </pre>
        )}
      </div>

      {/* Timeline */}
      <div className="border-line-layout bg-surface-panel rounded-[9px] border p-3">
        <p className="text-ink-faint mb-3 text-[10px] font-medium tracking-wide uppercase">
          Timeline
        </p>
        <TimelineEjecucion pasos={run.pasos} nodoActual={run.nodo_actual} />
      </div>

      {/* Acciones */}
      <div className="flex gap-2">
        {run.estado === "fallado" && nodoError && onReejecutar && (
          <button
            type="button"
            onClick={() => onReejecutar(run.id, nodoError)}
            className="border-line-control text-ink-secondary hover:bg-surface-hover inline-flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[11px] font-medium transition-colors"
          >
            <RotateCcw size={12} />
            Re-ejecutar desde error
          </button>
        )}
        <button
          type="button"
          onClick={handleCopiarDebug}
          className="border-line-control text-ink-secondary hover:bg-surface-hover inline-flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[11px] font-medium transition-colors"
        >
          <Copy size={12} />
          {copiado ? "Copiado!" : "Copiar datos debug"}
        </button>
      </div>
    </div>
  );
}
