import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { EditorDeGrafo } from "@/components/workflows/EditorDeGrafo";
import { VersionesDelWorkflow } from "@/components/workflows/VersionesDelWorkflow";
import { getCurrentRol } from "@/server/auth/guards";
import { getTagsAdminServiceForRequest } from "@/server/bootstrap/tags-bootstrap";
import { getWorkflowsAdminServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import { guardarVersionAction, publicarVersionAction } from "../_actions/workflows.actions";
import type { Grafo } from "@/types/workflows";

export const dynamic = "force-dynamic";

/** Un flujo vacío: un disparador y nada más, para no arrancar de la nada. */
const GRAFO_VACIO: Grafo = { nodos: [], aristas: [] };

export default async function WorkflowDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const svc = await getWorkflowsAdminServiceForRequest();
  const detalle = await svc.detalle(id);
  if (!detalle) notFound();

  const [rol, tags] = await Promise.all([
    getCurrentRol(),
    // Las etiquetas alimentan el select de la acción `poner_etiqueta`, que
    // necesita un `tagId` real: escribirlo a mano es un `tag_id_ausente` en
    // producción esperando a que alguien se equivoque de UUID.
    getTagsAdminServiceForRequest().then((s) => s.listar()),
  ]);
  const isAdmin = rol === "admin";

  // Se edita sobre la última versión guardada: es lo que alguien esperaría al
  // volver a una pantalla que dejó a medias.
  const ultima = detalle.versiones[0];
  const publicada = detalle.versiones.find((v) => v.publicada);

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title={detalle.workflow.nombre}
        subtitle={
          publicada
            ? `v${publicada.version} publicada · ${detalle.workflow.activo ? "prendido" : "apagado"}`
            : `sin versión publicada · ${detalle.workflow.activo ? "prendido" : "apagado"}`
        }
        actions={
          <Link
            href="/workflows"
            className="border-line-control text-ink-secondary hover:bg-surface-hover rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-semibold transition-colors"
          >
            Volver
          </Link>
        }
      />

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto flex max-w-[860px] flex-col gap-5">
          {!publicada && detalle.workflow.activo ? (
            <p className="rounded-[11px] border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[12px] text-amber-700 dark:text-amber-400">
              Este flujo está prendido pero no tiene ninguna versión publicada, así que{" "}
              <strong>no corre</strong>. Publicá una versión para que empiece.
            </p>
          ) : null}

          <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
            <h2 className="text-ink-primary mb-3 text-[13px] font-[680]">Versiones</h2>
            <VersionesDelWorkflow
              versiones={detalle.versiones}
              puedeEditar={isAdmin}
              onPublicar={publicarVersionAction}
            />
          </section>

          <EditorDeGrafo
            workflowId={detalle.workflow.id}
            grafoInicial={ultima?.grafo ?? GRAFO_VACIO}
            maxPasosInicial={ultima?.max_pasos ?? 50}
            tags={tags.map((t) => ({ id: t.id, nombre: t.nombre }))}
            puedeEditar={isAdmin}
            onGuardar={guardarVersionAction}
          />
        </div>
      </div>
    </div>
  );
}
