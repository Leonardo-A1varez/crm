"use client";

import { Close } from "@/components/icons";
import { CHIP_BASE, CHIP_ON } from "@/components/leads/ChipFiltro";
import { hayFiltros, resumirFiltros } from "@/lib/ui/filtros-productos";
import { cn } from "@/lib/utils";
import { useFiltrosProductos } from "./FiltrosProductosProvider";

/**
 * Los filtros que hay puestos, uno por chip, con la forma de sacar cada uno y
 * "Limpiar todo". Es el mismo resumen que dice el botón de cada encabezado, pero
 * a la vista sin abrir nada. Sin filtros no ocupa lugar.
 */
export function FiltrosActivos() {
  const { filtros, limpiar, limpiarTodo } = useFiltrosProductos();
  if (!hayFiltros(filtros)) return null;
  const resumen = resumirFiltros(filtros);

  return (
    <section
      aria-label="Filtros aplicados"
      className="border-line-layout bg-surface-panel flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-2.5"
    >
      <ul className="contents">
        {resumen.map(({ grupo, texto }) => (
          <li key={grupo} className="contents">
            <span className={cn(CHIP_BASE, CHIP_ON, "max-w-[360px]")}>
              <span className="truncate">{texto}</span>
              <button
                type="button"
                aria-label={`Quitar filtro: ${texto}`}
                onClick={() => limpiar([grupo])}
                className="text-ink-faint hover:text-ink-primary focus-visible:ring-brand/60 -mr-[3px] shrink-0 rounded-full p-0.5 outline-none focus-visible:ring-2"
              >
                <Close size={12} aria-hidden />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={limpiarTodo}
        className="text-ink-faint hover:text-ink-secondary focus-visible:ring-brand/60 shrink-0 rounded-[6px] px-1 py-0.5 text-[11.5px] font-[550] underline-offset-2 outline-none hover:underline focus-visible:ring-2"
      >
        Limpiar todo
      </button>
    </section>
  );
}

/** Botón suelto "Limpiar todos los filtros", para los estados vacío y de error. */
export function LimpiarFiltrosBoton() {
  const { limpiarTodo } = useFiltrosProductos();
  return (
    <button
      type="button"
      onClick={limpiarTodo}
      className="border-line-control text-ink-secondary hover:bg-surface-hover focus-visible:ring-brand/60 inline-flex items-center rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-semibold transition-colors outline-none focus-visible:ring-2"
    >
      Limpiar todos los filtros
    </button>
  );
}
