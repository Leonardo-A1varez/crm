import { PageHeader } from "@/components/shared/PageHeader";
import { CrearWorkflowDialog } from "@/components/workflows/CrearWorkflowDialog";
import { ListaWorkflows } from "@/components/workflows/ListaWorkflows";
import { getCurrentRol } from "@/server/auth/guards";
import { getWorkflowsAdminServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import { crearWorkflowAction } from "./_actions/workflows.actions";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const svc = await getWorkflowsAdminServiceForRequest();
  const [rol, workflows] = await Promise.all([getCurrentRol(), svc.listar()]);
  const isAdmin = rol === "admin";

  // Una lectura por workflow. Es N+1 y está asumido: los workflows de una
  // instalación son una docena, no miles, y `listar()` no trae la versión
  // publicada. Si algún día son cientos, esto se resuelve en el repo con un
  // join, no acá.
  const versiones = await Promise.all(
    workflows.map(async (w) => [w.id, (await svc.versionPublicada(w.id))?.version] as const),
  );
  const publicadas: Record<string, number> = {};
  for (const [id, version] of versiones) {
    if (version !== undefined) publicadas[id] = version;
  }

  const corriendo = workflows.filter((w) => w.activo && publicadas[w.id] !== undefined).length;

  return (
    <div className="bg-surface-root relative flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Flujos"
        subtitle={`${workflows.length} flujo${workflows.length === 1 ? "" : "s"} · ${corriendo} corriendo`}
        actions={isAdmin ? <CrearWorkflowDialog onCrear={crearWorkflowAction} /> : null}
      />
      <div className="flex-1 overflow-y-auto">
        <ListaWorkflows workflows={workflows} publicadas={publicadas} />
      </div>
    </div>
  );
}
