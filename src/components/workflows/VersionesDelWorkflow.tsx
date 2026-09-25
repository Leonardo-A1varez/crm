import Link from "next/link";
import type { WorkflowVersion } from "@/types/entities";

/**
 * Las versiones guardadas, y cuál está publicada.
 *
 * Publicar es lo que hace que una versión empiece a correr — `publicarVersion`
 * despublica la anterior en la misma operación. Las corridas que ya estaban en
 * vuelo NO se mueven: cada una quedó pinneada a la versión con la que arrancó
 * (`workflow_runs.workflow_version_id`), y eso se dice acá porque es lo que
 * hace que publicar sea seguro y no obvio.
 *
 * El botón no publica: lleva al diff de esa versión contra la publicada, que
 * es donde se ve qué cambia y se escribe la nota. Una versión más vieja que la
 * publicada se restaura como versión nueva; la vieja no se vuelve a encender.
 */
export function VersionesDelWorkflow({
  versiones,
  puedeEditar,
  hrefPublicar,
}: {
  versiones: readonly WorkflowVersion[];
  puedeEditar: boolean;
  /** A dónde lleva "Publicar" / "Restaurar": la pantalla del diff de esa versión. */
  hrefPublicar: (versionId: string) => string;
}) {
  if (versiones.length === 0) {
    return (
      <p className="text-ink-faint text-[12px]">
        Todavía no hay ninguna versión guardada. Armá el flujo abajo y guardalo.
      </p>
    );
  }

  const publicada = versiones.find((v) => v.publicada)?.version ?? null;

  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {versiones.map((v) => (
          <li key={v.id} className="flex items-center gap-3 text-[12px]">
            <span className="text-ink-primary w-10 font-mono font-semibold tabular-nums">
              v{v.version}
            </span>
            <span className="text-ink-faint">tope {v.max_pasos} pasos</span>
            <span className="text-ink-faint">{v.grafo.nodos.length} pasos</span>
            {v.publicada ? (
              <span className="bg-ok/10 text-ok rounded-[9px] px-2 py-0.5 text-[11px] font-semibold">
                publicada
              </span>
            ) : puedeEditar ? (
              <Link
                href={hrefPublicar(v.id)}
                className="border-line-control text-ink-secondary hover:bg-surface-hover rounded-[9px] border px-2 py-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              >
                {publicada !== null && v.version < publicada ? "Restaurar…" : "Publicar…"}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="text-ink-faint mt-2 text-[11px]">
        Publicar cambia lo que corre de acá en adelante. Las corridas que ya están en curso siguen
        con la versión con la que arrancaron.
      </p>
    </>
  );
}
