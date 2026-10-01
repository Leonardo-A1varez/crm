"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * El área de la tabla: scrollea por dentro y se atenúa mientras llega un filtro
 * nuevo (`aria-busy` del proveedor).
 *
 * El scroll es el del `table-container` de la tabla, no el de la ventana, así que
 * Next no lo reinicia al cambiar de página o de filtro: se vuelve arriba cuando
 * cambia `clave` (la URL), o la página 2 aparecería a mitad de camino.
 */
export function RegionTabla({ clave, children }: { clave: string; children: ReactNode }) {
  const region = useRef<HTMLDivElement>(null);

  useEffect(() => {
    region.current?.querySelector<HTMLElement>("[data-slot=table-container]")?.scrollTo({ top: 0 });
  }, [clave]);

  return (
    <div
      ref={region}
      className="min-h-0 flex-1 transition-opacity duration-150 group-aria-busy/filtros:opacity-60 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-y-auto"
    >
      {children}
    </div>
  );
}
