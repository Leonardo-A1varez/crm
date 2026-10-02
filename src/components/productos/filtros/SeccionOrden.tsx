"use client";

import { type CampoOrden } from "@/lib/catalogo/columnas-productos";
import {
  ordenarColumna,
  ordenDeColumna,
  quitarOrdenDeColumna,
  quitarTodoElOrden,
  rotulosDeOrden,
} from "@/lib/ui/orden-productos";
import { cn } from "@/lib/utils";
import { useFiltrosProductos } from "./FiltrosProductosProvider";

const BOTON =
  "focus-visible:ring-brand/60 flex min-h-[30px] w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12px] outline-none focus-visible:ring-2";

function clase(activo: boolean) {
  return cn(
    BOTON,
    activo
      ? "bg-surface-avatar text-ink-primary font-[600]"
      : "text-ink-secondary hover:bg-surface-hover",
  );
}

/**
 * Ordenar por la columna, acumulativo (reglas en `orden-productos.ts`): cada clic suma la
 * columna como el siguiente nivel, invierte su sentido si ya ordena o la saca si se vuelve
 * a tocar el sentido que ya tiene. Un botón marcado dice "ya ordena así" y tocarlo lo
 * apaga: se marca solo con lo que alguien eligió, no con el orden por defecto.
 *
 * Aplica al instante y cierra el panel: la lista de valores de abajo no tiene nada que
 * decir sobre un orden que ya se aplicó.
 */
export function SeccionOrden({
  campo,
  etiqueta,
  cerrar,
}: {
  campo: CampoOrden;
  /** Nombre de la columna, para el lector de pantalla: "Cód. fábrica". */
  etiqueta: string;
  cerrar: () => void;
}) {
  const { filtros, query, navegar } = useFiltrosProductos();
  const elegidos = filtros.orden;
  const propio = ordenDeColumna(elegidos, campo);
  const rotulos = rotulosDeOrden(campo);

  const ir = (params: URLSearchParams) => {
    navegar(params);
    cerrar();
  };

  return (
    <section aria-label={`Ordenar ${etiqueta}`} className="flex flex-col gap-0.5 p-2">
      <button
        type="button"
        aria-pressed={propio.dir === "asc"}
        onClick={() => ir(ordenarColumna(query, campo, "asc"))}
        className={clase(propio.dir === "asc")}
      >
        <span aria-hidden className="w-3 font-mono">
          ↑
        </span>
        Ordenar {rotulos.asc}
      </button>
      <button
        type="button"
        aria-pressed={propio.dir === "desc"}
        onClick={() => ir(ordenarColumna(query, campo, "desc"))}
        className={clase(propio.dir === "desc")}
      >
        <span aria-hidden className="w-3 font-mono">
          ↓
        </span>
        Ordenar {rotulos.desc}
      </button>
      {/* Solo cuando hay algo que quitar. Con un único nivel, "esta columna" y "todo" son lo
          mismo: se ofrece una sola. */}
      {propio.nivel !== null ? (
        <button
          type="button"
          onClick={() => ir(quitarOrdenDeColumna(query, campo))}
          className={cn(clase(false), "text-ink-dim")}
        >
          <span aria-hidden className="w-3 font-mono">
            ×
          </span>
          Quitar orden de esta columna
        </button>
      ) : null}
      {propio.niveles > 1 ? (
        <button
          type="button"
          onClick={() => ir(quitarTodoElOrden(query))}
          className={cn(clase(false), "text-ink-dim")}
        >
          <span aria-hidden className="w-3 font-mono">
            ×
          </span>
          Quitar todo el orden
        </button>
      ) : null}
    </section>
  );
}
