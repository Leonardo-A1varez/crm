"use client";

import { useState, useTransition } from "react";
import { Eye, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkflowVersion } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";
import { VersionBadge, estadoDeVersion } from "./VersionBadge";

interface VersionHistoryProps {
  versiones: readonly WorkflowVersion[];
  versionActualId: string;
  puedeEditar: boolean;
  onVerVersion: (versionId: string) => void;
  onRollback: (versionId: string) => Promise<ActionResult>;
}

/**
 * Formato relativo simple para fechas cercanas.
 */
function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  if (hours < 24) return `hace ${hours} h`;
  if (days < 7) return `hace ${days} d`;

  return date.toLocaleDateString("es", { day: "numeric", month: "short" });
}

/**
 * Lista de versiones con opcion de ver y rollback.
 *
 * Muestra todas las versiones ordenadas de la mas nueva a la mas vieja, con
 * indicador de cual esta publicada y cual se esta viendo actualmente.
 */
export function VersionHistory({
  versiones,
  versionActualId,
  puedeEditar,
  onVerVersion,
  onRollback,
}: VersionHistoryProps) {
  const [rollbackTarget, setRollbackTarget] = useState<WorkflowVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ejecutando, startRollback] = useTransition();

  if (versiones.length === 0) {
    return <p className="text-ink-faint text-[12px]">Todavia no hay ninguna version guardada.</p>;
  }

  const handleRollback = () => {
    if (!rollbackTarget) return;
    setError(null);
    startRollback(async () => {
      const result = await onRollback(rollbackTarget.id);
      if (result.ok) {
        setRollbackTarget(null);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <h4 className="text-ink-primary text-[12px] font-semibold">Historial de versiones</h4>

        <div className="flex flex-col gap-1.5">
          {versiones.map((v) => {
            const esActual = v.id === versionActualId;
            const esPublicada = v.publicada;

            return (
              <div
                key={v.id}
                className={cn(
                  "border-line-layout flex items-center justify-between rounded-lg border p-3",
                  esActual && "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20",
                  esPublicada && !esActual && "border-emerald-500/60",
                )}
              >
                <div className="flex items-center gap-3">
                  <VersionBadge estado={estadoDeVersion(v.publicada)} />
                  <span className="text-ink-primary text-[12px] font-semibold">v{v.version}</span>
                  {esActual && (
                    <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">
                      editando
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-ink-faint mr-2 text-[11px]">
                    {formatRelative(new Date(v.created_at))}
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => onVerVersion(v.id)}
                    title="Ver esta version"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>

                  {puedeEditar && !esPublicada && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setRollbackTarget(v)}
                      title="Restaurar esta version"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-ink-faint mt-1 text-[11px]">
          Las corridas en curso siguen con la version con la que arrancaron.
        </p>
      </div>

      {/* Dialog de confirmacion de rollback */}
      <Dialog open={!!rollbackTarget} onOpenChange={(open) => !open && setRollbackTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restaurar version {rollbackTarget?.version}?</DialogTitle>
            <DialogDescription>
              Esto creara una nueva version con el mismo contenido de la version{" "}
              {rollbackTarget?.version} y la publicara. Las corridas en curso no se afectan.
            </DialogDescription>
          </DialogHeader>

          {error && <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRollbackTarget(null)} disabled={ejecutando}>
              Cancelar
            </Button>
            <Button onClick={handleRollback} disabled={ejecutando}>
              {ejecutando ? "Restaurando..." : "Restaurar y publicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
