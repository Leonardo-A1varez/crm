import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkflowsAdminServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import { obtenerPreviaPublicacionAction } from "../../../_actions/workflows.actions";
import { PublicarVersionCliente } from "../../_components/PublicarVersionCliente";

export const dynamic = "force-dynamic";

/**
 * `/workflows/[id]/publicar/[versionId]` — el diff de una versión contra la
 * publicada, antes de publicarla.
 *
 * Es ruta y no diálogo porque el diff se dibuja sobre el lienzo entero: en un
 * modal de 480 px un flujo de 30 bloques no se lee. Y es de admin: la previa la
 * pide `obtenerPreviaPublicacionAction`, que ya corta a cualquier otro rol con
 * un mensaje, y la pantalla lo muestra en vez de un lienzo vacío.
 */
export default async function PublicarVersionPage({
  params,
}: {
  params: Promise<{ id: string; versionId: string }>;
}) {
  const { id, versionId } = await params;

  const previa = await obtenerPreviaPublicacionAction({ versionId });
  if (!previa.ok) {
    return (
      <div className="bg-surface-root flex h-full flex-col items-center justify-center gap-3 p-8">
        <p role="alert" className="text-ink-body max-w-md text-center text-[12.5px] text-pretty">
          {previa.error}
        </p>
        <Link
          href={`/workflows/${id}`}
          className="border-line-card text-ink-secondary hover:bg-surface-hover rounded-[8px] border px-2.5 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          Volver al editor
        </Link>
      </div>
    );
  }

  const { workflow, nueva, actual, corridasVivas, problemas } = previa.data;
  // Una versión de otro flujo con el id de éste en la URL: no se publica desde acá.
  if (workflow.id !== id) notFound();

  // El tope de pasos no viaja en la previa y no es parte del grafo: se lee de
  // las versiones del flujo para que un cambio de tope cuente como cambio.
  const detalle = await getWorkflowsAdminServiceForRequest().then((s) => s.detalle(id));
  const tope = (versionId_: string) =>
    detalle?.versiones.find((v) => v.id === versionId_)?.max_pasos ?? null;

  return (
    <div className="bg-surface-root h-full">
      <PublicarVersionCliente
        workflowId={workflow.id}
        nombreFlujo={workflow.nombre}
        nueva={{ ...nueva, maxPasos: tope(nueva.id) }}
        actual={actual ? { ...actual, maxPasos: tope(actual.id) } : null}
        corridasVivas={corridasVivas}
        problemas={problemas}
      />
    </div>
  );
}
