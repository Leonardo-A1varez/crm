import Link from "next/link";
import { EmptyState } from "@/components/shared/EmptyState";
import type { Workflow } from "@/types/entities";

/**
 * Los flujos que existen.
 *
 * La columna que importa es si está publicado: un workflow `activo` sin versión
 * publicada **no corre**, y el que lo mira desde afuera no tiene cómo saberlo.
 * Por eso los dos estados se muestran separados en vez de un solo semáforo.
 */
export function ListaWorkflows({
  workflows,
  publicadas,
}: {
  workflows: readonly Workflow[];
  /** Por workflow, el número de versión publicada. Ausente = ninguna. */
  publicadas: Readonly<Record<string, number>>;
}) {
  if (workflows.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay flujos"
        description="Un flujo automatiza lo que hoy hace alguien a mano: seguir una cotización, etiquetar, escalar."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2 p-5">
      {workflows.map((w) => {
        const version = publicadas[w.id];
        const corriendo = w.activo && version !== undefined;
        return (
          <li key={w.id}>
            <Link
              href={`/workflows/${w.id}`}
              className="border-line-layout bg-surface-panel hover:bg-surface-hover flex items-center gap-3 rounded-[11px] border px-4 py-3 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-ink-primary truncate text-[13px] font-[680]">{w.nombre}</p>
                {w.descripcion ? (
                  <p className="text-ink-faint mt-0.5 truncate text-[11.5px]">{w.descripcion}</p>
                ) : null}
              </div>

              <span
                className={`shrink-0 rounded-[9px] px-2 py-1 text-[11px] font-semibold ${
                  corriendo
                    ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-500"
                    : "text-ink-faint border-line-control border"
                }`}
              >
                {corriendo ? "corriendo" : w.activo ? "prendido, sin publicar" : "apagado"}
              </span>

              <span className="text-ink-faint shrink-0 text-[11px]">
                {version !== undefined ? `v${version} publicada` : "sin versión publicada"}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
