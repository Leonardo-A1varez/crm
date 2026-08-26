"use client";

import { useState, useTransition } from "react";
import type { WorkflowVersion } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * Las versiones guardadas, y cuál está publicada.
 *
 * Publicar es lo que hace que una versión empiece a correr — `publicarVersion`
 * despublica la anterior en la misma operación. Las corridas que ya estaban en
 * vuelo NO se mueven: cada una quedó pinneada a la versión con la que arrancó
 * (`workflow_runs.workflow_version_id`), y eso se dice acá porque es lo que
 * hace que publicar sea seguro y no obvio.
 */
export function VersionesDelWorkflow({
  versiones,
  puedeEditar,
  onPublicar,
}: {
  versiones: readonly WorkflowVersion[];
  puedeEditar: boolean;
  /** Llega por prop: `components/**` no puede importar actions de `app/**`. */
  onPublicar: (input: { versionId: string }) => Promise<ActionResult>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [publicando, startPublicar] = useTransition();

  if (versiones.length === 0) {
    return (
      <p className="text-ink-faint text-[12px]">
        Todavía no hay ninguna versión guardada. Armá el flujo abajo y guardalo.
      </p>
    );
  }

  const publicar = (versionId: string) => {
    setError(null);
    startPublicar(async () => {
      const r = await onPublicar({ versionId });
      if (!r.ok) setError(r.error);
    });
  };

  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {versiones.map((v) => (
          <li key={v.id} className="flex items-center gap-3 text-[12px]">
            <span className="text-ink-primary w-10 font-semibold">v{v.version}</span>
            <span className="text-ink-faint">tope {v.max_pasos} pasos</span>
            <span className="text-ink-faint">{v.grafo.nodos.length} pasos</span>
            {v.publicada ? (
              <span className="rounded-[9px] bg-emerald-600/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-500">
                publicada
              </span>
            ) : puedeEditar ? (
              <button
                type="button"
                onClick={() => publicar(v.id)}
                disabled={publicando}
                className="border-line-control text-ink-secondary hover:bg-surface-hover rounded-[9px] border px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-40"
              >
                {publicando ? "…" : "Publicar"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="text-ink-faint mt-2 text-[11px]">
        Publicar cambia lo que corre de acá en adelante. Las corridas que ya están en curso siguen
        con la versión con la que arrancaron.
      </p>

      {error ? <p className="mt-2 text-[11.5px] text-red-600 dark:text-red-400">{error}</p> : null}
    </>
  );
}
