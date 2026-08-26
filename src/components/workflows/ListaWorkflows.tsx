"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/EmptyState";
import { WorkflowCard } from "@/components/workflows/WorkflowCard";
import type { WorkflowResumen } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

type AccionWorkflow = (input: { workflowId: string }) => Promise<ActionResult>;

/**
 * Las cards de `/workflows`, ya filtradas y ordenadas por el server component
 * (`filtrarYOrdenarWorkflows` corrió en la página, no acá). Este componente
 * sólo dibuja y dispara las cuatro mutaciones del menú -- duplicar/pausar/
 * reanudar/eliminar-- vía las actions que llegan por prop: `components/**` no
 * puede importar `app/**` (boundaries), mismo patrón que `onCrear` en
 * `CrearWorkflowDialog`.
 *
 * Cada mutación pasa por `router.refresh()`: no hay estado local de la lista,
 * la fuente de verdad sigue siendo el fetch del server component.
 */
export function ListaWorkflows({
  items,
  totalSinFiltrar,
  puedeEditar,
  onDuplicar,
  onPausar,
  onReanudar,
  onEliminar,
}: {
  items: readonly WorkflowResumen[];
  /** Total de workflows SIN aplicar busqueda/estado: decide cuál de los dos vacíos mostrar. */
  totalSinFiltrar: number;
  puedeEditar: boolean;
  onDuplicar: AccionWorkflow;
  onPausar: AccionWorkflow;
  onReanudar: AccionWorkflow;
  onEliminar: AccionWorkflow;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function ejecutar(accion: AccionWorkflow, mensajeExito: string) {
    return (workflowId: string) => {
      startTransition(async () => {
        const r = await accion({ workflowId });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(mensajeExito);
        router.refresh();
      });
    };
  }

  if (totalSinFiltrar === 0) {
    return (
      <EmptyState
        title="Todavía no hay flujos"
        description="Un flujo automatiza lo que hoy hace alguien a mano: seguir una cotización, etiquetar, escalar."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Ningún flujo coincide"
        description="Probá con otra búsqueda o sacá el filtro de estado."
      />
    );
  }

  const duplicar = ejecutar(onDuplicar, "Flujo duplicado.");
  const pausar = ejecutar(onPausar, "Flujo pausado.");
  const reanudar = ejecutar(onReanudar, "Flujo reanudado.");
  const eliminar = ejecutar(onEliminar, "Flujo eliminado.");

  return (
    <ul className="flex flex-col gap-2 p-5">
      {items.map((item) => (
        <WorkflowCard
          key={item.workflow.id}
          item={item}
          puedeEditar={puedeEditar}
          onDuplicar={duplicar}
          onPausar={pausar}
          onReanudar={reanudar}
          onEliminar={eliminar}
        />
      ))}
    </ul>
  );
}
