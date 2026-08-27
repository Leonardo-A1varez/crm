"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { validarWorkflow, agruparErrores, puedePublicar } from "@/lib/workflows/validar-workflow";
import type { Workflow, WorkflowVersion } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: Workflow;
  version: WorkflowVersion;
  onPublicar: (input: { versionId: string; descripcion?: string }) => Promise<ActionResult>;
}

/**
 * Modal de publicación con validación pre-vuelo.
 *
 * Muestra errores críticos que bloquean la publicación y advertencias que no
 * bloquean pero conviene revisar. Permite agregar una descripción del cambio
 * para el historial.
 */
export function PublishDialog({
  open,
  onOpenChange,
  workflow,
  version,
  onPublicar,
}: PublishDialogProps) {
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [publicando, startPublicar] = useTransition();

  // Validar solo cuando el dialog está abierto
  const errores = useMemo(() => {
    if (!open || !version) return [];
    return validarWorkflow(version.grafo);
  }, [open, version]);

  const { criticos, advertencias } = agruparErrores(errores);
  const permitido = puedePublicar(errores);

  const handlePublicar = () => {
    setError(null);
    startPublicar(async () => {
      const result = await onPublicar({
        versionId: version.id,
        descripcion: descripcion.trim() || undefined,
      });
      if (result.ok) {
        setDescripcion("");
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publicar workflow</DialogTitle>
          <DialogDescription>
            Publicar esta versión la activa inmediatamente. Las corridas en curso siguen con la
            versión anterior.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Resumen de la versión */}
          <div className="bg-surface-secondary rounded-lg p-4">
            <div className="text-ink-primary text-[13px] font-medium">{workflow.nombre}</div>
            <div className="text-ink-secondary text-[12px]">
              Versión {version.version} - {version.grafo.nodos.length} nodos
            </div>
          </div>

          {/* Sin errores: todo bien */}
          {errores.length === 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-[13px] font-medium text-emerald-700 dark:text-emerald-300">
                  Listo para publicar
                </p>
                <p className="text-[12px] text-emerald-600 dark:text-emerald-400">
                  El workflow pasó todas las validaciones.
                </p>
              </div>
            </div>
          )}

          {/* Errores críticos */}
          {criticos.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4">
              <AlertCircle className="mt-0.5 h-4 w-4 text-red-600 dark:text-red-400" />
              <div className="flex-1">
                <p className="text-[13px] font-medium text-red-700 dark:text-red-300">
                  No se puede publicar
                </p>
                <ul className="mt-2 space-y-1">
                  {criticos.map((e, i) => (
                    <li key={i} className="text-[12px] text-red-600 dark:text-red-400">
                      {e.mensaje}
                      {e.sugerencia && <span className="text-red-500/80"> - {e.sugerencia}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Advertencias */}
          {advertencias.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400" />
              <div className="flex-1">
                <p className="text-[13px] font-medium text-amber-700 dark:text-amber-300">
                  Advertencias
                </p>
                <ul className="mt-2 space-y-1">
                  {advertencias.map((e, i) => (
                    <li key={i} className="text-[12px] text-amber-600 dark:text-amber-400">
                      {e.mensaje}
                      {e.sugerencia && <span className="text-amber-500/80"> - {e.sugerencia}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Descripción del cambio */}
          {permitido && (
            <div className="space-y-2">
              <label htmlFor="descripcion" className="text-ink-secondary text-[12px] font-medium">
                Descripcion del cambio (opcional)
              </label>
              <Textarea
                id="descripcion"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Que cambio en esta version?"
                rows={2}
                className="text-[12px]"
              />
            </div>
          )}

          {/* Error de la accion */}
          {error && <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={publicando}>
            Cancelar
          </Button>
          <Button onClick={handlePublicar} disabled={!permitido || publicando}>
            {publicando ? "Publicando..." : "Publicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
