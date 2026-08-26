import { PageHeader } from "@/components/shared/PageHeader";
import { CrearWorkflowDialog } from "@/components/workflows/CrearWorkflowDialog";
import { FiltrosWorkflows } from "@/components/workflows/FiltrosWorkflows";
import { ListaWorkflows } from "@/components/workflows/ListaWorkflows";
import { parseFiltrosWorkflowsParams } from "@/lib/ui/filtros-workflows";
import { getCurrentRol } from "@/server/auth/guards";
import {
  crearWorkflowAction,
  deleteWorkflowAction,
  duplicateWorkflowAction,
  getWorkflowsAction,
  pauseWorkflowAction,
  resumeWorkflowAction,
} from "./_actions/workflows.actions";
import type { ValorParam } from "@/lib/ui/filtros-leads";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, ValorParam>>;
}) {
  const params = await searchParams;
  const filtros = parseFiltrosWorkflowsParams(params);

  const [rol, resultado] = await Promise.all([getCurrentRol(), getWorkflowsAction(filtros)]);
  const isAdmin = rol === "admin";

  const corriendo = resultado.ok ? resultado.activosCorriendo : 0;
  const total = resultado.ok ? resultado.totalSinFiltrar : 0;

  return (
    <div className="bg-surface-root relative flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Flujos"
        subtitle={`${total} flujo${total === 1 ? "" : "s"} · ${corriendo} corriendo`}
        actions={isAdmin ? <CrearWorkflowDialog onCrear={crearWorkflowAction} /> : null}
      />
      <FiltrosWorkflows
        q={filtros.busqueda}
        estado={filtros.estado ?? "todos"}
        ordenar={filtros.ordenar ?? "editado"}
      />
      <div className="flex-1 overflow-y-auto">
        {resultado.ok ? (
          <ListaWorkflows
            items={resultado.items}
            totalSinFiltrar={resultado.totalSinFiltrar}
            puedeEditar={isAdmin}
            onDuplicar={duplicateWorkflowAction}
            onPausar={pauseWorkflowAction}
            onReanudar={resumeWorkflowAction}
            onEliminar={deleteWorkflowAction}
          />
        ) : (
          <p className="p-5 text-[12px] text-red-600 dark:text-red-400">{resultado.error}</p>
        )}
      </div>
    </div>
  );
}
