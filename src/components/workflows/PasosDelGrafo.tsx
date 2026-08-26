import { ETIQUETA_NODO, ETIQUETA_PUERTO } from "@/lib/workflows/catalogo";
import { pasosDelGrafo } from "@/lib/workflows/pasos";
import type { Grafo } from "@/types/workflows";

/**
 * El grafo leído como una lista encadenada, sin dibujarlo.
 *
 * La sangría es la profundidad desde el disparador, así se ve la forma del
 * flujo —y sobre todo las dos ramas de una condición— sin lienzo ni arrastre.
 * Los nodos inalcanzables van abajo y separados: son un error de armado
 * (`nodo_inalcanzable`) y esconderlos sería esconderlo.
 */
export function PasosDelGrafo({ grafo }: { grafo: Grafo }) {
  const { pasos, inalcanzables } = pasosDelGrafo(grafo);

  if (pasos.length === 0 && inalcanzables.length === 0) {
    return (
      <p className="text-ink-faint px-4 py-6 text-[12.5px]">
        Este flujo todavía no tiene ningún paso.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {pasos.map((paso, i) => (
        <div
          key={`${paso.nodo.id}-${i}`}
          className="flex items-center gap-2"
          // La sangría se calcula: no hay una clase de Tailwind por cada
          // profundidad posible y generarlas dinámicamente no las compila.
          style={{ paddingLeft: `${paso.profundidad * 18}px` }}
        >
          {paso.puerto ? (
            <span className="text-ink-faint shrink-0 text-[10.5px]">
              └ {ETIQUETA_PUERTO[paso.puerto] ?? paso.puerto}
            </span>
          ) : null}
          <span
            className={`border-line-control inline-flex items-center gap-1.5 rounded-[9px] border px-2 py-1 text-[11.5px] ${
              paso.repetido ? "text-ink-faint border-dashed" : "text-ink-primary bg-surface-panel"
            }`}
          >
            <span className="font-semibold">{ETIQUETA_NODO[paso.nodo.tipo] ?? paso.nodo.tipo}</span>
            <span className="text-ink-faint">{resumen(paso.nodo.config)}</span>
            {paso.repetido ? <span className="text-ink-faint">↩ vuelve acá</span> : null}
          </span>
        </div>
      ))}

      {inalcanzables.length > 0 ? (
        <div className="border-line-layout mt-3 border-t pt-3">
          <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-500">
            {inalcanzables.length} paso{inalcanzables.length === 1 ? "" : "s"} sin conectar — el
            flujo nunca va a llegar ahí
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {inalcanzables.map((n) => (
              <span
                key={n.id}
                className="border-line-control text-ink-faint rounded-[9px] border border-dashed px-2 py-1 text-[11.5px]"
              >
                {ETIQUETA_NODO[n.tipo] ?? n.tipo} · {n.id}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Lo más útil de `config` en una línea. Es opaca para el motor, no para el ojo. */
function resumen(config: Record<string, unknown>): string {
  const accion = config["accion"];
  if (typeof accion === "string") return accion;
  const disparador = config["disparador"];
  if (typeof disparador === "string") return disparador;
  const campo = config["campo"];
  if (typeof campo === "string") return `${campo} ${String(config["operador"] ?? "")}`.trim();
  const minutos = config["minutos"];
  if (typeof minutos === "number") return `${minutos} min`;
  return "";
}
