"use client";

import { cn } from "@/lib/utils";
import { ESTADOS_RUN } from "./estados";
import type { WorkflowRunListItem } from "./types";

interface RunCardProps {
  run: WorkflowRunListItem;
  onClick: (runId: string) => void;
  isSelected: boolean;
}

/** Formatea la duracion en ms a un string legible (1.2s, 340ms) */
function formatDuracion(ms: number | null): string {
  if (ms === null) return "...";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Formatea la fecha relativa (Hoy 14:32, Ayer 09:15) */
function formatFechaRelativa(date: Date): string {
  const ahora = new Date();
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const ayer = new Date(hoy.getTime() - 24 * 60 * 60 * 1000);

  const hora = date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  if (date >= hoy) {
    return `Hoy ${hora}`;
  }
  if (date >= ayer) {
    return `Ayer ${hora}`;
  }
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" }) + ` ${hora}`;
}

/**
 * Tarjeta de un run con estado, lead y duracion.
 */
export function RunCard({ run, onClick, isSelected }: RunCardProps) {
  const estadoConfig = ESTADOS_RUN[run.estado];
  const Icono = estadoConfig.icono;

  const nombreLead = run.lead_nombre || "Lead sin nombre";

  // Info secundaria: paso actual o error
  let infoSecundaria: string | null = null;
  if (run.estado === "fallado" && run.error) {
    infoSecundaria = `Error en: ${run.error.slice(0, 50)}${run.error.length > 50 ? "..." : ""}`;
  } else if (run.estado === "corriendo" && run.nodo_actual) {
    infoSecundaria = `Paso: ${run.nodo_actual}`;
  } else if (run.estado === "esperando" && run.nodo_actual) {
    infoSecundaria = `Esperando en: ${run.nodo_actual}`;
  }

  return (
    <button
      type="button"
      onClick={() => onClick(run.id)}
      className={cn(
        "border-line-layout w-full rounded-[9px] border p-3 text-left transition-colors",
        isSelected
          ? "bg-surface-hover border-ink-faint/30"
          : "bg-surface-panel hover:bg-surface-hover",
      )}
    >
      {/* Encabezado: estado + fecha + duracion */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold",
            estadoConfig.bg,
            estadoConfig.color,
          )}
        >
          <Icono size={12} />
          {estadoConfig.label}
        </span>
        <span className="text-ink-faint text-[10px]">
          {formatFechaRelativa(run.iniciado_en)} · {formatDuracion(run.duracion_ms)}
        </span>
      </div>

      {/* Lead */}
      <p className="text-ink-primary truncate text-[12px] font-medium">Lead: {nombreLead}</p>

      {/* Trigger */}
      <p className="text-ink-faint truncate text-[11px]">Trigger: {run.trigger_tipo}</p>

      {/* Info secundaria (paso actual o error) */}
      {infoSecundaria && (
        <p
          className={cn(
            "mt-1 truncate text-[11px]",
            run.estado === "fallado" ? "text-red-600 dark:text-red-400" : "text-ink-secondary",
          )}
        >
          {infoSecundaria}
        </p>
      )}
    </button>
  );
}
