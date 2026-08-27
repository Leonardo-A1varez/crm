"use client";

import { useState, useCallback, useTransition, useEffect } from "react";
import { Search, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RunCard } from "./RunCard";
import { RunDetail } from "./RunDetail";
import { ESTADOS_RUN } from "./estados";
import type { WorkflowRunEstado } from "@/types/entities";
import type { WorkflowRunListItem, WorkflowRunDetalle, FiltrosHistorial } from "./types";
import type { ActionResult } from "@/types/inbox";

interface PanelHistorialProps {
  workflowId: string;
  /** Action para cargar el historial con paginacion cursor */
  onCargarHistorial: (
    workflowId: string,
    filtros: FiltrosHistorial,
    cursor?: string,
  ) => Promise<{ runs: WorkflowRunListItem[]; nextCursor: string | null; total: number }>;
  /** Action para cargar el detalle de un run */
  onCargarDetalle: (runId: string) => Promise<WorkflowRunDetalle | null>;
  /** Action para re-ejecutar desde un nodo (opcional) */
  onReejecutar?: (runId: string, nodoId: string) => Promise<ActionResult>;
}

const ESTADOS_FILTRO: readonly (WorkflowRunEstado | "todos")[] = [
  "todos",
  "corriendo",
  "esperando",
  "terminado",
  "fallado",
  "cancelado",
];

const ETIQUETA_FILTRO: Record<WorkflowRunEstado | "todos", string> = {
  todos: "Todos",
  corriendo: "En ejecucion",
  esperando: "Esperando",
  terminado: "Completado",
  fallado: "Error",
  cancelado: "Cancelado",
};

/**
 * Panel lateral de historial de 320px con lista de runs, filtros y detalle.
 */
export function PanelHistorial({
  workflowId,
  onCargarHistorial,
  onCargarDetalle,
  onReejecutar,
}: PanelHistorialProps) {
  // Estado de la lista
  const [runs, setRuns] = useState<WorkflowRunListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cargando, startCarga] = useTransition();
  const [cargandoMas, startCargaMas] = useTransition();

  // Filtros
  const [busqueda, setBusqueda] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<WorkflowRunEstado | "todos">("todos");
  const [menuEstadoAbierto, setMenuEstadoAbierto] = useState(false);

  // Detalle
  const [runSeleccionado, setRunSeleccionado] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<WorkflowRunDetalle | null>(null);
  const [cargandoDetalle, startCargaDetalle] = useTransition();

  // Cargar historial inicial
  const cargarHistorial = useCallback(
    (cursor?: string) => {
      const filtros: FiltrosHistorial = {
        estado: estadoFiltro,
        busqueda: busqueda.trim() || undefined,
      };

      if (cursor) {
        startCargaMas(async () => {
          const result = await onCargarHistorial(workflowId, filtros, cursor);
          setRuns((prev) => [...prev, ...result.runs]);
          setNextCursor(result.nextCursor);
        });
      } else {
        startCarga(async () => {
          const result = await onCargarHistorial(workflowId, filtros);
          setRuns(result.runs);
          setTotal(result.total);
          setNextCursor(result.nextCursor);
        });
      }
    },
    [workflowId, estadoFiltro, busqueda, onCargarHistorial],
  );

  // Cargar al montar y cuando cambian los filtros
  useEffect(() => {
    cargarHistorial();
  }, [cargarHistorial]);

  // Cargar detalle cuando se selecciona un run
  useEffect(() => {
    if (!runSeleccionado) {
      return;
    }

    startCargaDetalle(async () => {
      const result = await onCargarDetalle(runSeleccionado);
      setDetalle(result);
    });
  }, [runSeleccionado, onCargarDetalle]);

  // Limpiar detalle cuando se deselecciona el run
  const deseleccionarRun = useCallback(() => {
    setRunSeleccionado(null);
    setDetalle(null);
  }, []);

  const handleReejecutar = useCallback(
    async (runId: string, nodoId: string) => {
      if (!onReejecutar) return;
      const result = await onReejecutar(runId, nodoId);
      if (result.ok) {
        // Recargar historial para ver el nuevo run
        cargarHistorial();
        deseleccionarRun();
      }
    },
    [onReejecutar, cargarHistorial, deseleccionarRun],
  );

  // Vista de detalle
  if (runSeleccionado && detalle) {
    return (
      <aside className="border-line-layout bg-surface-panel flex h-full w-[320px] shrink-0 flex-col border-l">
        <div className="border-line-layout border-b px-3 py-2.5">
          <h2 className="text-ink-primary text-[13px] font-[680]">Detalle de ejecucion</h2>
        </div>
        <ScrollArea className="flex-1 p-3">
          <RunDetail
            run={detalle}
            onBack={deseleccionarRun}
            onReejecutar={onReejecutar ? handleReejecutar : undefined}
          />
        </ScrollArea>
      </aside>
    );
  }

  if (runSeleccionado && cargandoDetalle) {
    return (
      <aside className="border-line-layout bg-surface-panel flex h-full w-[320px] shrink-0 flex-col items-center justify-center border-l">
        <Loader2 className="text-ink-faint size-6 animate-spin" />
      </aside>
    );
  }

  // Vista de lista
  return (
    <aside className="border-line-layout bg-surface-panel flex h-full w-[320px] shrink-0 flex-col border-l">
      {/* Encabezado */}
      <div className="border-line-layout border-b px-3 py-2.5">
        <h2 className="text-ink-primary text-[13px] font-[680]">Historial de ejecuciones</h2>
      </div>

      {/* Filtros */}
      <div className="border-line-layout flex gap-2 border-b px-3 py-2">
        {/* Busqueda */}
        <div className="relative flex-1">
          <Search className="text-ink-faint pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filtrar..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="border-line-control bg-surface-root text-ink-primary placeholder:text-ink-ghost w-full rounded-[7px] border py-1 pr-2 pl-7 text-[11px]"
          />
        </div>

        {/* Filtro de estado */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuEstadoAbierto((v) => !v)}
            className="border-line-control bg-surface-root text-ink-secondary hover:bg-surface-hover inline-flex items-center gap-1 rounded-[7px] border px-2 py-1 text-[11px] transition-colors"
          >
            {ETIQUETA_FILTRO[estadoFiltro]}
            <ChevronDown size={12} />
          </button>

          {menuEstadoAbierto && (
            <>
              {/* Overlay para cerrar */}
              <div className="fixed inset-0 z-10" onClick={() => setMenuEstadoAbierto(false)} />
              <div className="border-line-layout bg-surface-panel absolute top-full right-0 z-20 mt-1 w-[130px] rounded-[8px] border py-1 shadow-lg">
                {ESTADOS_FILTRO.map((estado) => (
                  <button
                    key={estado}
                    type="button"
                    onClick={() => {
                      setEstadoFiltro(estado);
                      setMenuEstadoAbierto(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors",
                      estado === estadoFiltro
                        ? "bg-surface-hover text-ink-primary font-medium"
                        : "text-ink-secondary hover:bg-surface-hover",
                    )}
                  >
                    {estado !== "todos" && (
                      <span className={cn("size-2 rounded-full", ESTADOS_RUN[estado].bg)} />
                    )}
                    {ETIQUETA_FILTRO[estado]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Lista de runs */}
      <ScrollArea className="flex-1">
        {cargando ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-ink-faint size-5 animate-spin" />
          </div>
        ) : runs.length === 0 ? (
          <p className="text-ink-faint px-3 py-8 text-center text-[12px] italic">
            {estadoFiltro !== "todos" || busqueda
              ? "Ninguna ejecucion coincide con los filtros."
              : "Todavia no hay ejecuciones."}
          </p>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            {runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                onClick={setRunSeleccionado}
                isSelected={runSeleccionado === run.id}
              />
            ))}

            {/* Cargar mas */}
            {nextCursor && (
              <button
                type="button"
                onClick={() => cargarHistorial(nextCursor)}
                disabled={cargandoMas}
                className="text-ink-secondary hover:bg-surface-hover mt-2 rounded-[7px] py-2 text-center text-[11px] font-medium transition-colors disabled:opacity-50"
              >
                {cargandoMas ? <Loader2 className="mx-auto size-4 animate-spin" /> : "Cargar mas"}
              </button>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Contador */}
      {!cargando && runs.length > 0 && (
        <div className="border-line-layout text-ink-faint border-t px-3 py-2 text-[10px]">
          Mostrando {runs.length} de {total.toLocaleString("es-AR")} ejecuciones
        </div>
      )}
    </aside>
  );
}
