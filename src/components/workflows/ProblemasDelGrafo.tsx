import type { ProblemaGrafo } from "@/types/workflows";

/**
 * Lo que `validarGrafo()` encontró mal, antes de intentar guardar.
 *
 * Se muestran TODOS y no el primero: quien está armando un flujo quiere ver de
 * una vez todo lo que le falta, que es el mismo criterio que usa
 * `guardarVersion` al componer su mensaje de error.
 *
 * Cuando no hay problemas se dice explícitamente. El silencio no distingue
 * "está sano" de "todavía no se validó".
 */
export function ProblemasDelGrafo({ problemas }: { problemas: readonly ProblemaGrafo[] }) {
  if (problemas.length === 0) {
    return (
      <p className="text-[11.5px] font-medium text-emerald-600 dark:text-emerald-500">
        El flujo está sano: se puede guardar y publicar.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {problemas.map((p, i) => (
        <li
          key={`${p.regla}-${i}`}
          className="flex items-start gap-2 text-[11.5px] text-red-600 dark:text-red-400"
        >
          <span aria-hidden className="mt-px shrink-0">
            ●
          </span>
          <span>
            {p.mensaje}
            {p.nodos.length > 0 ? (
              <span className="text-ink-faint"> — {p.nodos.join(", ")}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
