"use client";

import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WorkflowRunDetalle } from "@/types/entities";
import type { LeadListItem } from "@/types/leads";
import type { Grafo } from "@/types/workflows";

type BuscarLeadsFn = (
  raw: unknown,
) => Promise<{ ok: true; items: LeadListItem[] } | { ok: false; error: string }>;

type ProbarFn = (
  raw: unknown,
) => Promise<
  | { ok: true; runId: string; tipo: "completado" | "esperando" | "fallado"; error?: string }
  | { ok: false; error: string }
>;

type ProbarHastaAcaFn = (raw: unknown) => Promise<
  | {
      ok: true;
      runId: string;
      tipo: "detenido" | "completado" | "fallado" | "cancelado";
      nodoId?: string;
      error?: string;
    }
  | { ok: false; error: string }
>;

type ObtenerDetalleRunFn = (
  raw: unknown,
) => Promise<{ ok: true; data: WorkflowRunDetalle | null } | { ok: false; error: string }>;

interface ProbarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  grafo: Grafo;
  maxPasos: number;
  onBuscarLeads: BuscarLeadsFn;
  onProbar: ProbarFn;
  onObtenerDetalleRun: ObtenerDetalleRunFn;
  /**
   * "Ejecutar hasta acá": con un nodo, el modal corre el flujo contra el lead
   * elegido y frena justo antes de ese nodo (`probarHastaAcaAction`, mismo
   * input que Probar más `hastaNodo`). En vez de mostrar el resultado acá,
   * abre la pantalla de la corrida con `onIrACorrida`: ahí se ve el lienzo
   * pintado hasta donde llegó.
   */
  hastaNodo?: { id: string; nombre: string } | null;
  onProbarHastaAca?: ProbarHastaAcaFn;
  onIrACorrida?: (runId: string) => void;
}

const ETIQUETA_ESTADO: Record<string, string> = {
  completado: "Completó",
  esperando: "Cortó en una espera",
  fallado: "Falló",
};

/**
 * Modal de "Probar": elegir un lead real, correr el motor de verdad contra
 * él, y ver qué hizo paso a paso.
 *
 * Seguro de correr: los handlers de mensajería/CRM del motor son puros — no
 * mandan WhatsApp ni tocan la base real, sólo devuelven qué habrían hecho
 * (`pendiente_envio`/`pendiente_ejecucion`). Lo único que se persiste de
 * verdad es la corrida en `workflow_runs`/`workflow_run_pasos`, que es
 * exactamente lo que este modal muestra.
 */
export function ProbarDialog({
  open,
  onOpenChange,
  workflowId,
  grafo,
  maxPasos,
  onBuscarLeads,
  onProbar,
  onObtenerDetalleRun,
  hastaNodo = null,
  onProbarHastaAca,
  onIrACorrida,
}: ProbarDialogProps) {
  const modoHasta = hastaNodo !== null && onProbarHastaAca !== undefined ? hastaNodo : null;
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<LeadListItem[]>([]);
  const [leadElegido, setLeadElegido] = useState<LeadListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runResumen, setRunResumen] = useState<{
    tipo: "completado" | "esperando" | "fallado";
    error?: string;
  } | null>(null);
  const [detalle, setDetalle] = useState<WorkflowRunDetalle | null>(null);
  const [buscando, startBuscar] = useTransition();
  const [ejecutando, startEjecutar] = useTransition();

  // Buscar con un pequeño debounce: no una consulta por tecla. Sin nada que
  // limpiar cuando no corresponde buscar: el render de abajo ya condiciona
  // la lista a `query` no vacía, así que un resultado viejo simplemente no
  // se muestra en vez de tener que resetearlo acá.
  useEffect(() => {
    if (!open || leadElegido || query.trim().length === 0) return;
    const id = setTimeout(() => {
      startBuscar(async () => {
        const r = await onBuscarLeads({ q: query.trim() });
        setResultados(r.ok ? r.items : []);
      });
    }, 300);
    return () => clearTimeout(id);
  }, [query, open, leadElegido, onBuscarLeads]);

  /** La próxima vez que se abra, empieza de cero — se resetea al cerrar, no con un efecto. */
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQuery("");
      setResultados([]);
      setLeadElegido(null);
      setError(null);
      setRunResumen(null);
      setDetalle(null);
    }
    onOpenChange(next);
  };

  const handleProbar = () => {
    if (!leadElegido) return;
    setError(null);
    if (modoHasta && onProbarHastaAca) {
      startEjecutar(async () => {
        const r = await onProbarHastaAca({
          workflowId,
          grafo,
          maxPasos,
          leadId: leadElegido.leadId,
          hastaNodo: modoHasta.id,
        });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        onIrACorrida?.(r.runId);
      });
      return;
    }
    startEjecutar(async () => {
      const r = await onProbar({ workflowId, grafo, maxPasos, leadId: leadElegido.leadId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setRunResumen({ tipo: r.tipo, error: r.error });
      const d = await onObtenerDetalleRun({ runId: r.runId });
      if (d.ok) setDetalle(d.data);
    });
  };

  const mostrandoResultado = runResumen !== null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-balance">
            {modoHasta ? `Ejecutar hasta «${modoHasta.nombre}»` : "Probar workflow"}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {modoHasta
              ? "Elegí un lead real. El flujo corre contra él y frena justo antes de este bloque; después se abre la corrida para ver hasta dónde llegó. No se manda ningún WhatsApp ni se toca el lead: sólo se simula."
              : mostrandoResultado
                ? "Esto es lo que hizo el motor. Los mensajes y cambios al lead no se enviaron de verdad — sólo se simularon."
                : "Elegí un lead real para correr el flujo contra él. No se manda ningún WhatsApp ni se toca el lead: sólo se simula."}
          </DialogDescription>
        </DialogHeader>

        {!mostrandoResultado ? (
          <div className="flex flex-col gap-3">
            {leadElegido ? (
              <div className="bg-surface-secondary flex items-center justify-between rounded-lg p-3">
                <div>
                  <p className="text-ink-primary text-[13px] font-medium">{leadElegido.nombre}</p>
                  <p className="text-ink-faint text-[11px]">{leadElegido.telefono}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setLeadElegido(null)}>
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <Search
                    size={14}
                    className="text-ink-faint absolute top-1/2 left-2.5 -translate-y-1/2"
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar lead por nombre o teléfono..."
                    className="pl-8"
                  />
                </div>
                {buscando ? (
                  <p className="text-ink-faint text-[12px]">Buscando…</p>
                ) : query.trim().length > 0 && resultados.length > 0 ? (
                  <ul className="border-line-layout max-h-[220px] overflow-y-auto rounded-lg border">
                    {resultados.map((lead) => (
                      <li key={lead.leadId}>
                        <button
                          type="button"
                          onClick={() => setLeadElegido(lead)}
                          className="hover:bg-surface-hover flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors"
                        >
                          <span className="text-ink-primary text-[12.5px] font-medium">
                            {lead.nombre}
                          </span>
                          <span className="text-ink-faint text-[11px]">{lead.telefono}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : query.trim().length > 0 ? (
                  <p className="text-ink-faint text-[12px]">Sin resultados.</p>
                ) : null}
              </div>
            )}

            {error && (
              <p role="alert" className="text-[12px] text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div
              className={`rounded-lg border p-3 text-[13px] font-medium ${
                runResumen.tipo === "fallado"
                  ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                  : runResumen.tipo === "esperando"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              }`}
            >
              {ETIQUETA_ESTADO[runResumen.tipo]}
              {runResumen.error ? `: ${runResumen.error}` : ""}
            </div>

            {detalle && detalle.pasos.length > 0 ? (
              <ol className="flex flex-col gap-2">
                {detalle.pasos.map((paso) => (
                  <li key={paso.id} className="border-line-layout rounded-lg border p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-ink-primary text-[12px] font-semibold">
                        {paso.nodo_id}
                      </span>
                      {paso.error ? (
                        <span className="text-[11px] text-red-600 dark:text-red-400">error</span>
                      ) : (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          ok
                        </span>
                      )}
                    </div>
                    {paso.error ? (
                      <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                        {paso.error}
                      </p>
                    ) : paso.salida && Object.keys(paso.salida).length > 0 ? (
                      <pre className="bg-surface-hover text-ink-secondary mt-1.5 max-h-[100px] overflow-auto rounded-md p-2 text-[10px]">
                        {JSON.stringify(paso.salida, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {mostrandoResultado ? (
            <Button onClick={() => handleOpenChange(false)}>Cerrar</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={ejecutando}
              >
                Cancelar
              </Button>
              <Button onClick={handleProbar} disabled={!leadElegido || ejecutando}>
                {modoHasta
                  ? ejecutando
                    ? "Ejecutando…"
                    : "Ejecutar hasta acá"
                  : ejecutando
                    ? "Probando…"
                    : "Probar"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
