import { PageHeader } from "@/components/shared/PageHeader";
import { TagFormDialog } from "@/components/tags/TagFormDialog";
import { TagsTable } from "@/components/tags/TagsTable";
import { getCurrentRol } from "@/server/auth/guards";
import { getTagsAdminServiceForRequest } from "@/server/bootstrap/tags-bootstrap";
import { borrarTagAction, crearTagAction, editarTagAction } from "./_actions/tags.actions";
import type { TagListItem } from "@/types/tags";

export const dynamic = "force-dynamic";

/**
 * El subtítulo cuenta cuántas están en uso y no solo el total: una etiqueta sin
 * leads es candidata a borrarse y ese es el trabajo que se viene a hacer acá.
 */
function subtitulo(tags: TagListItem[]): string {
  const total = tags.length === 1 ? "1 etiqueta" : `${tags.length} etiquetas`;
  const enUso = tags.filter((t) => t.leadsUsando > 0).length;
  return `${total} · ${enUso} en uso`;
}

export default async function TagsPage() {
  const svc = await getTagsAdminServiceForRequest();
  const [rol, tags] = await Promise.all([getCurrentRol(), svc.listar()]);
  const isAdmin = rol === "admin";

  return (
    // `h-full` y no `h-screen`: el shell del panel ya mide la pantalla.
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Tags"
        subtitle={subtitulo(tags)}
        actions={
          isAdmin ? (
            <TagFormDialog
              title="Nueva etiqueta"
              description="Se cuelga de un lead desde el panel de conversación."
              triggerLabel="Nueva etiqueta"
              onSubmit={crearTagAction}
            />
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <TagsTable
          tags={tags}
          isAdmin={isAdmin}
          onEditar={editarTagAction}
          onBorrar={borrarTagAction}
        />
      </div>
    </div>
  );
}
