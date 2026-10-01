"use client";

import { TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { grupoActivo } from "@/lib/ui/filtros-productos";
import { cn } from "@/lib/utils";
import {
  CuerpoCategoria,
  CuerpoCodigo,
  CuerpoDescripcion,
  CuerpoEstado,
  CuerpoPrecio,
  CuerpoStock,
} from "./Cuerpos";
import { FiltroColumna } from "./FiltroColumna";
import { useFiltrosProductos } from "./FiltrosProductosProvider";
import type { ReactNode } from "react";

/**
 * El encabezado queda fijo al hacer scroll: el botón de filtro tiene que estar
 * a mano con 50 filas debajo. El fondo es opaco y la línea de abajo es una
 * sombra interna, porque el `border-bottom` de una celda `sticky` se queda
 * atrás cuando el resto sigue de largo.
 */
const TH =
  "text-ink-faint bg-surface-panel sticky top-0 z-10 h-auto px-3 py-1.5 first:pl-5 last:pr-5 font-mono text-[9px] font-semibold tracking-[0.13em] uppercase shadow-[inset_0_-1px_0_var(--color-line-layout)]";

function Columna({
  etiqueta,
  derecha,
  activo,
  children,
}: {
  etiqueta: string;
  derecha?: boolean;
  activo?: boolean;
  children?: ReactNode;
}) {
  return (
    <TableHead scope="col" className={cn(TH, activo && "text-ink-secondary")}>
      <div className={cn("flex items-center gap-1", derecha && "justify-end")}>
        <span>{etiqueta}</span>
        {children}
      </div>
    </TableHead>
  );
}

/**
 * Fila de encabezados de `/productos` con el botón de filtro de cada columna.
 * Las columnas que se filtran leen de la URL si tienen algo puesto, así que el
 * indicador es el mismo que muestran los chips de arriba.
 *
 * Descripción filtra dos cosas —el texto y la marca— y las dos viven en el mismo
 * desplegable, porque la marca se ve debajo de la descripción en cada fila.
 */
export function EncabezadoProductos({ isAdmin }: { isAdmin: boolean }) {
  const { filtros } = useFiltrosProductos();
  const activo = (g: Parameters<typeof grupoActivo>[1]) => grupoActivo(filtros, g);
  const descripcionActiva = activo("descripcion") || activo("marca");

  return (
    <TableHeader>
      <TableRow className="border-line-layout hover:bg-transparent">
        <Columna etiqueta="Código" activo={activo("codigo")}>
          <FiltroColumna etiqueta="Código" activo={activo("codigo")}>
            {(cerrar) => <CuerpoCodigo cerrar={cerrar} />}
          </FiltroColumna>
        </Columna>
        <Columna etiqueta="Descripción" activo={descripcionActiva}>
          <FiltroColumna etiqueta="Descripción" activo={descripcionActiva} ancho={320}>
            {(cerrar) => <CuerpoDescripcion cerrar={cerrar} />}
          </FiltroColumna>
        </Columna>
        <Columna etiqueta="Categoría" activo={activo("categoria")}>
          <FiltroColumna etiqueta="Categoría" activo={activo("categoria")} ancho={304}>
            {(cerrar) => <CuerpoCategoria cerrar={cerrar} />}
          </FiltroColumna>
        </Columna>
        <Columna etiqueta="Precio" derecha activo={activo("precio")}>
          <FiltroColumna etiqueta="Precio" activo={activo("precio")}>
            {(cerrar) => <CuerpoPrecio cerrar={cerrar} />}
          </FiltroColumna>
        </Columna>
        <Columna etiqueta="Stock" derecha activo={activo("stock")}>
          <FiltroColumna etiqueta="Stock" activo={activo("stock")}>
            {(cerrar) => <CuerpoStock cerrar={cerrar} />}
          </FiltroColumna>
        </Columna>
        <Columna etiqueta="Estado" activo={activo("estado")}>
          <FiltroColumna etiqueta="Estado" activo={activo("estado")}>
            {(cerrar) => <CuerpoEstado cerrar={cerrar} />}
          </FiltroColumna>
        </Columna>
        {isAdmin ? (
          <TableHead scope="col" className={cn(TH, "w-44 text-right")}>
            Acciones
          </TableHead>
        ) : null}
      </TableRow>
    </TableHeader>
  );
}
