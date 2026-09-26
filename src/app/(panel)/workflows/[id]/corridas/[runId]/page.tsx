import Link from "next/link";
import { notFound } from "next/navigation";
import { getLogger } from "@/lib/observability/get-logger";
import { catalogosCondicionAction } from "../../../_actions/condicion.actions";
import { obtenerCorridaAction } from "../../../_actions/corridas.actions";
import { zonaDelNegocio } from "../../../../difusion/_lib/zona";
import { CorridaEnVivoCliente } from "../../_components/CorridaEnVivoCliente";

export const dynamic = "force-dynamic";

/**
 * `/workflows/[id]/corridas/[runId]` — una corrida sobre el mismo lienzo en el
 * que se editó el flujo, en vivo mientras corre.
 *
 * El grafo es el de la versión con la que arrancó la corrida, no el publicado
 * hoy: lo trae la vista. Las horas se muestran en la zona del negocio; la
 * función que la lee es la de Difusión, que ya resuelve el caso de no poder
 * leer la configuración (UTC y un aviso en el log).
 */
export default async function CorridaPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;

  const [r, zona, catalogos] = await Promise.all([
    obtenerCorridaAction({ runId }),
    zonaDelNegocio(getLogger({ scope: "workflows" })),
    // Para que la condición nombre sus intents y etiquetas igual que en el
    // editor. Si no se pueden leer, el nodo dice "un intent": la corrida se ve
    // igual.
    catalogosCondicionAction(),
  ]);

  if (!r.ok) {
    return (
      <div className="bg-surface-root flex h-full flex-col items-center justify-center gap-3 p-8">
        <p role="alert" className="text-ink-body max-w-md text-center text-[12.5px] text-pretty">
          {r.error}
        </p>
        <Link
          href={`/workflows/${id}/historial`}
          className="border-line-card text-ink-secondary hover:bg-surface-hover rounded-[8px] border px-2.5 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          Volver al historial
        </Link>
      </div>
    );
  }
  // Sin corrida, o una de otro flujo con el id de éste en la URL.
  if (r.data === null || r.data.workflow.id !== id) notFound();

  return (
    <div className="bg-surface-root h-full">
      <CorridaEnVivoCliente
        workflowId={id}
        inicial={r.data}
        zona={zona}
        catalogos={catalogos.ok ? catalogos.data : undefined}
      />
    </div>
  );
}
