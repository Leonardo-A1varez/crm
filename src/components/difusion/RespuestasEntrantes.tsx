import { formatearEntero } from "./formato";
import { Nota } from "./primitivas";
import type { RespuestaEnvio } from "./tipos";

/**
 * Las respuestas a una difusión (PRD §7.6).
 *
 * Una respuesta es el primer mensaje que el lead manda después de recibir la
 * difusión (hasta 7 días después). Entra a la Bandeja como una conversación
 * más, con la plantilla anotada en el hilo, y dispara los flujos «Difusión
 * respondida». Acá se ven las más recientes; el total cuenta todas.
 */
export function RespuestasEntrantes({
  total,
  recientes,
}: {
  total: number;
  recientes: readonly RespuestaEnvio[];
}) {
  if (total === 0) {
    return (
      <Nota>
        Todavía no respondió nadie. Cuando alguien conteste, su mensaje entra a la Bandeja con la
        difusión anotada y aparece acá.
      </Nota>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-faint text-[11px] leading-relaxed text-pretty">
        Entran a la Bandeja como cualquier conversación y disparan los flujos «Difusión respondida».
        {total > recientes.length ? (
          <>
            {" "}
            Se ven las{" "}
            <span className="font-mono tabular-nums">{formatearEntero(recientes.length)}</span> más
            recientes de <span className="font-mono tabular-nums">{formatearEntero(total)}</span>.
          </>
        ) : null}
      </p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
        {recientes.map((r) => (
          <li
            key={r.clave}
            className="border-line-card bg-surface-card flex min-w-0 flex-col gap-1 rounded-[9px] border px-3 py-2.5"
          >
            <span className="text-ink-primary truncate text-[12px] font-[650]">
              {r.nombre || "Sin nombre"}
            </span>
            <span className="text-ink-secondary line-clamp-2 text-[11.5px] leading-snug text-pretty">
              {r.texto === null ? (
                <span className="text-ink-faint italic">El mensaje ya no está en el hilo.</span>
              ) : (
                `“${r.texto}”`
              )}
            </span>
            <span className="text-ink-faint text-[10.5px]">{r.hace}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
