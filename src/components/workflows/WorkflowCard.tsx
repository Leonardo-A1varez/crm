"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  DeleteIcon,
  DuplicateIcon,
  Edit,
  ErrorIcon,
  MoreHoriz,
  PauseIcon,
  PlayIcon,
  TaskAlt,
} from "@/components/icons";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
import { esperaLegible } from "@/lib/triage";
import { cn } from "@/lib/utils";
import {
  ESTADO_WORKFLOW_BADGE,
  ESTADO_WORKFLOW_DOT,
  ESTADO_WORKFLOW_LABEL,
} from "@/lib/ui/workflow-estado";
import type { WorkflowEstado, WorkflowResumen } from "@/types/entities";
import type { ComponentType } from "react";

const ICONO_ESTADO: Record<WorkflowEstado, ComponentType<{ size?: number; className?: string }>> = {
  activo: TaskAlt,
  borrador: Edit,
  pausado: PauseIcon,
  error: ErrorIcon,
};

/** "hace 12m" contra el reloj actual. Envuelta para no llamar `Date.now` en el render. */
function desdeHace(date: Date): string {
  return esperaLegible(Date.now() - date.getTime());
}

/**
 * Una fila de `/workflows`. Es un `<Link>` que ocupa la card entera —click
 * navega al editor— con el menú de 3 puntos afuera de ese link y no adentro:
 * un `<button>` no puede vivir dentro de un `<a>` (contenido interactivo
 * anidado, inválido en HTML), así que el menú es hermano del link y se
 * superpone con `absolute`, no descendiente.
 */
export function WorkflowCard({
  item,
  puedeEditar,
  onDuplicar,
  onPausar,
  onReanudar,
  onEliminar,
}: {
  item: WorkflowResumen;
  /** Vendedor ve la card; sólo admin ve el menú de acciones (mismo gate que crear/publicar). */
  puedeEditar: boolean;
  onDuplicar: (workflowId: string) => void;
  onPausar: (workflowId: string) => void;
  onReanudar: (workflowId: string) => void;
  onEliminar: (workflowId: string) => void;
}) {
  const { workflow, estado, tieneVersionBorrador, metricas, resumenPasos, ultimaEdicion } = item;
  const Icono = ICONO_ESTADO[estado];
  const porcentajeOk =
    metricas.totalRuns > 0 ? Math.round((metricas.runsExitosos / metricas.totalRuns) * 100) : null;

  return (
    <li className="relative">
      <Link
        href={`/workflows/${workflow.id}`}
        className="border-line-layout bg-surface-panel hover:bg-surface-hover flex flex-col gap-2 rounded-[11px] border px-4 py-3 pr-11 transition-colors"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn("size-[7px] shrink-0 rounded-full", ESTADO_WORKFLOW_DOT[estado])}
          />
          <p className="text-ink-primary min-w-0 truncate text-[13px] font-[680]">
            {workflow.nombre}
          </p>
          {tieneVersionBorrador ? (
            <span className="shrink-0 rounded-[7px] bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700 dark:text-amber-500">
              BORRADOR
            </span>
          ) : null}
        </div>

        {resumenPasos.length > 0 ? (
          <p className="text-ink-faint truncate text-[11.5px]">{resumenPasos.join(" → ")}</p>
        ) : (
          <p className="text-ink-ghost truncate text-[11.5px] italic">Todavía no tiene pasos.</p>
        )}

        <div className="text-ink-faint flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-[7px] px-1.5 py-0.5 font-semibold",
              ESTADO_WORKFLOW_BADGE[estado],
            )}
          >
            <Icono size={11} />
            {ESTADO_WORKFLOW_LABEL[estado]}
          </span>
          <span>
            {metricas.totalRuns.toLocaleString("es-AR")} run{metricas.totalRuns === 1 ? "" : "s"}
          </span>
          {porcentajeOk !== null ? <span>{porcentajeOk}% ok</span> : null}
          {metricas.ultimoRun ? <span>Último: {desdeHace(metricas.ultimoRun.at)}</span> : null}
          <span>Editado {desdeHace(ultimaEdicion)}</span>
        </div>
      </Link>

      {puedeEditar ? (
        <div className="absolute top-3 right-3 z-10">
          <WorkflowCardMenu
            workflowId={workflow.id}
            activo={workflow.activo}
            onDuplicar={onDuplicar}
            onPausar={onPausar}
            onReanudar={onReanudar}
            onEliminar={onEliminar}
          />
        </div>
      ) : null}
    </li>
  );
}

function WorkflowCardMenu({
  workflowId,
  activo,
  onDuplicar,
  onPausar,
  onReanudar,
  onEliminar,
}: {
  workflowId: string;
  activo: boolean;
  onDuplicar: (workflowId: string) => void;
  onPausar: (workflowId: string) => void;
  onReanudar: (workflowId: string) => void;
  onEliminar: (workflowId: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  // Un paso intermedio adentro del mismo menú: eliminar un flujo no vuelve, y
  // un `confirm()` del navegador no dice nada de lo que se va a perder.
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);

  const cerrar = () => {
    setAbierto(false);
    setConfirmandoBorrado(false);
  };
  useCerrarAlSalir(abierto, contenedor, cerrar);

  const itemClass =
    "text-ink-secondary hover:bg-surface-hover flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors";

  return (
    <div ref={contenedor} className="relative">
      <button
        type="button"
        aria-label="Acciones del flujo"
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAbierto((v) => !v);
          setConfirmandoBorrado(false);
        }}
        className="text-ink-faint hover:bg-surface-hover hover:text-ink-secondary flex size-6 items-center justify-center rounded-[7px] transition-colors"
      >
        <MoreHoriz size={15} />
      </button>

      {abierto ? (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="border-line-layout bg-surface-panel absolute top-7 right-0 z-20 w-[180px] rounded-[10px] border py-1 shadow-lg"
        >
          <Link href={`/workflows/${workflowId}`} role="menuitem" className={itemClass}>
            <Edit size={13} /> Editar
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              cerrar();
              onDuplicar(workflowId);
            }}
            className={itemClass}
          >
            <DuplicateIcon size={13} /> Duplicar
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              cerrar();
              (activo ? onPausar : onReanudar)(workflowId);
            }}
            className={itemClass}
          >
            {activo ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
            {activo ? "Pausar" : "Reanudar"}
          </button>
          <div className="bg-line-layout my-1 h-px" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (!confirmandoBorrado) {
                setConfirmandoBorrado(true);
                return;
              }
              cerrar();
              onEliminar(workflowId);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-semibold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <DeleteIcon size={13} /> {confirmandoBorrado ? "Confirmar borrado" : "Eliminar"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
