"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  DeleteIcon,
  DuplicateIcon,
  Edit,
  MoreHoriz,
  PauseIcon,
  PlayIcon,
} from "@/components/icons";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
import { SEMANTICA_PAUSA } from "@/lib/ui/workflow-estado";
import type { WorkflowEstado } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

type AccionFlujo = (input: { workflowId: string }) => Promise<ActionResult>;

const ITEM =
  "text-ink-secondary hover:bg-surface-hover flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-brand)]";

/**
 * Editar, duplicar, pausar/reanudar y eliminar un flujo, desde su tarjeta.
 *
 * Vive en `app/**` y no en `components/**` porque las cuatro son Server
 * Actions: un componente no puede importarlas (boundaries de ESLint), así que
 * la pantalla arma el control y se lo pasa a `TarjetaFlujo` por el slot
 * `acciones`. Es el mismo reparto que ya usaba `ListaWorkflows` con la tarjeta
 * vieja, sólo que ahora el que dibuja no es el que sabe.
 *
 * Cada mutación termina en `router.refresh()`: no hay copia local de la lista,
 * la fuente de verdad sigue siendo el fetch del server component.
 */
export function MenuFlujo({
  workflowId,
  estado,
  onDuplicar,
  onPausar,
  onReanudar,
  onEliminar,
}: {
  workflowId: string;
  estado: WorkflowEstado;
  onDuplicar: AccionFlujo;
  onPausar: AccionFlujo;
  onReanudar: AccionFlujo;
  onEliminar: AccionFlujo;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  // Un paso intermedio dentro del propio menú: eliminar un flujo no vuelve, y
  // un `confirm()` del navegador no dice qué se pierde.
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, startEnviar] = useTransition();
  const contenedor = useRef<HTMLDivElement>(null);

  const cerrar = () => {
    setAbierto(false);
    setConfirmando(false);
  };
  useCerrarAlSalir(abierto, contenedor, cerrar);

  function ejecutar(accion: AccionFlujo, exito: string) {
    cerrar();
    startEnviar(async () => {
      const r = await accion({ workflowId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(exito);
      router.refresh();
    });
  }

  // Pausado es el único estado en el que reanudar tiene sentido; los otros
  // cuatro están encendidos. Se deriva del estado y no de `workflow.activo`
  // para no tener dos verdades sobre lo mismo en la misma pantalla.
  const pausado = estado === "pausado";

  return (
    <div ref={contenedor} className="relative">
      <button
        type="button"
        aria-label="Acciones del flujo"
        aria-haspopup="menu"
        aria-expanded={abierto}
        disabled={enviando}
        onClick={() => {
          setAbierto((v) => !v);
          setConfirmando(false);
        }}
        className="text-ink-faint hover:bg-surface-hover hover:text-ink-secondary flex size-7 items-center justify-center rounded-[8px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:opacity-50"
      >
        <MoreHoriz size={15} />
      </button>

      {abierto ? (
        <div
          role="menu"
          className="border-line-layout bg-surface-panel absolute top-8 right-0 z-30 w-[248px] rounded-[10px] border py-1 shadow-lg"
        >
          <Link href={`/workflows/${workflowId}`} role="menuitem" className={ITEM}>
            <Edit size={13} aria-hidden /> Editar
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => ejecutar(onDuplicar, "Flujo duplicado.")}
            className={ITEM}
          >
            <DuplicateIcon size={13} aria-hidden /> Duplicar
          </button>

          {/* La promesa de pausar, dicha ANTES de pausar: es el momento en que
              alguien decide, y es cuando importa saber que esto no aborta nada
              que ya esté andando. Sale de `SEMANTICA_PAUSA` para que las copias
              en pantalla no puedan divergir. */}
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              pausado
                ? ejecutar(onReanudar, "Flujo reanudado.")
                : ejecutar(onPausar, "Flujo pausado.")
            }
            className={`${ITEM} flex-col items-start gap-0.5`}
          >
            <span className="flex items-center gap-2">
              {pausado ? <PlayIcon size={13} aria-hidden /> : <PauseIcon size={13} aria-hidden />}
              {pausado ? "Reanudar" : "Pausar"}
            </span>
            {pausado ? null : (
              <span className="text-ink-ghost pl-[21px] text-[10.5px] leading-snug">
                {SEMANTICA_PAUSA.frena} {SEMANTICA_PAUSA.respeta}
              </span>
            )}
          </button>

          <div className="bg-line-layout my-1 h-px" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (!confirmando) {
                setConfirmando(true);
                return;
              }
              ejecutar(onEliminar, "Flujo eliminado.");
            }}
            className="text-danger hover:bg-danger/10 flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            <DeleteIcon size={13} aria-hidden /> {confirmando ? "Confirmar borrado" : "Eliminar"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
