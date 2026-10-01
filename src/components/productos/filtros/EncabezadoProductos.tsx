"use client";

import { grupoActivo } from "@/lib/ui/filtros-productos";
import { ordenDeColumna } from "@/lib/ui/orden-productos";
import { cn } from "@/lib/utils";
import { ANCHO_ACCIONES, COLUMNAS_TABLA, type ColumnaTabla } from "../columnas";
import { CuerpoEstado, CuerpoLista, CuerpoPrecio, CuerpoStock } from "./Cuerpos";
import { FiltroColumna } from "./FiltroColumna";
import { useFiltrosProductos } from "./FiltrosProductosProvider";
import { SeccionOrden } from "./SeccionOrden";

/**
 * El encabezado queda fijo al hacer scroll: el botón de la columna tiene que estar a
 * mano con 21.000 filas debajo. El fondo es opaco y la línea de abajo es una sombra
 * interna, porque el `border-bottom` de una celda `sticky` se queda atrás cuando el
 * resto sigue de largo.
 */
const TH =
  "text-ink-faint bg-surface-panel sticky top-0 z-10 h-auto p-0 font-mono text-[9px] font-semibold tracking-[0.13em] uppercase shadow-[inset_0_-1px_0_var(--color-line-layout)]";

const ANCHO_PANEL_LISTA = 296;
const ANCHO_PANEL_RANGO = 264;

function ContenidoPanel({ columna, cerrar }: { columna: ColumnaTabla; cerrar: () => void }) {
  const f = columna.filtro;
  return (
    <>
      <SeccionOrden campo={columna.id} etiqueta={columna.etiqueta} cerrar={cerrar} />
      <div className="border-line-layout border-t" />
      {f.tipo === "lista" ? (
        <CuerpoLista columna={f.columna} />
      ) : f.tipo === "precio" ? (
        <CuerpoPrecio cerrar={cerrar} />
      ) : f.tipo === "stock" ? (
        <CuerpoStock cerrar={cerrar} />
      ) : (
        <CuerpoEstado cerrar={cerrar} />
      )}
    </>
  );
}

/**
 * La fila de encabezados de `/productos`. Cada encabezado es un botón que abre su panel
 * de orden y filtro, y lleva a la vista si la columna está filtrada y por cuál nivel del
 * orden manda. Los dos indicadores leen de la URL, así que dicen lo mismo que los chips.
 */
export function EncabezadoProductos({ isAdmin }: { isAdmin: boolean }) {
  const { filtros } = useFiltrosProductos();

  return (
    <thead>
      <tr aria-rowindex={1} className="text-left">
        {COLUMNAS_TABLA.map((c) => {
          const orden = ordenDeColumna(filtros.orden, c.id);
          // `aria-sort` en TODA columna que ordena, no solo en el primer nivel: el lector de
          // pantalla tiene que oír por qué columnas está ordenada la tabla.
          const ordenada = orden.nivel !== null && orden.dir !== null;
          return (
            <th
              key={c.id}
              scope="col"
              aria-sort={ordenada ? (orden.dir === "asc" ? "ascending" : "descending") : undefined}
              className={TH}
            >
              <FiltroColumna
                etiqueta={c.etiqueta}
                activo={grupoActivo(filtros, c.grupo)}
                orden={orden}
                derecha={c.derecha}
                ancho={c.filtro.tipo === "lista" ? ANCHO_PANEL_LISTA : ANCHO_PANEL_RANGO}
              >
                {(cerrar) => <ContenidoPanel columna={c} cerrar={cerrar} />}
              </FiltroColumna>
            </th>
          );
        })}
        {isAdmin ? (
          <th
            scope="col"
            className={cn(TH, "px-3.5 py-2 text-right")}
            style={{ width: ANCHO_ACCIONES }}
          >
            Acciones
          </th>
        ) : null}
      </tr>
    </thead>
  );
}
