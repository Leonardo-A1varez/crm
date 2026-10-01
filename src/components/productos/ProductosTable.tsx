import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { EncabezadoProductos } from "./filtros/EncabezadoProductos";
import { LimpiarFiltrosBoton } from "./filtros/FiltrosActivos";
import { ProductoRowActions } from "./ProductoRowActions";
import type {
  SetProductoActivoInput,
  UpdateProductoInput,
} from "@/lib/validation/productos.schema";
import type { ActionResult } from "@/types/inbox";
import type { Producto } from "@/types/entities";
import type { ReactNode } from "react";

const precioFmt = new Intl.NumberFormat("es", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const TD = "px-3 py-[9px] first:pl-5 last:pr-5";

/** Qué muestra el cuerpo de la tabla. El encabezado con los filtros está siempre. */
export type VistaProductos =
  | { tipo: "filas"; productos: Producto[] }
  /** Hay catálogo, pero ningún producto pasa los filtros. */
  | { tipo: "sin-resultados" }
  /** El service rechazó los filtros de la URL. */
  | { tipo: "invalido"; mensajes: string[] };

function FilaMensaje({ columnas, children }: { columnas: number; children: ReactNode }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columnas} className="px-5 py-14">
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
          {children}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function ProductosTable({
  vista,
  isAdmin,
  onUpdate,
  onToggleActivo,
}: {
  vista: VistaProductos;
  isAdmin: boolean;
  onUpdate: (input: UpdateProductoInput) => Promise<ActionResult>;
  onToggleActivo: (input: SetProductoActivoInput) => Promise<ActionResult>;
}) {
  const columnas = isAdmin ? 7 : 6;

  return (
    <Table className="text-[12.5px]">
      <EncabezadoProductos isAdmin={isAdmin} />
      <TableBody>
        {vista.tipo === "invalido" ? (
          <FilaMensaje columnas={columnas}>
            <div role="alert" className="flex flex-col items-center gap-1.5">
              <p className="text-ink-primary text-[13px] font-semibold">
                No se pudieron aplicar los filtros
              </p>
              {vista.mensajes.map((m) => (
                <p key={m} className="text-ink-dim text-[12px]">
                  {m}
                </p>
              ))}
            </div>
            <LimpiarFiltrosBoton />
          </FilaMensaje>
        ) : vista.tipo === "sin-resultados" ? (
          <FilaMensaje columnas={columnas}>
            <div className="flex flex-col items-center gap-1">
              <p className="text-ink-primary text-[13px] font-semibold">
                Ningún producto coincide con los filtros
              </p>
              <p className="text-ink-dim text-[12px]">
                Probá con menos filtros o con otros valores.
              </p>
            </div>
            <LimpiarFiltrosBoton />
          </FilaMensaje>
        ) : (
          vista.productos.map((p) => (
            <TableRow
              key={p.id}
              className={`border-line-layout hover:bg-surface-elevated ${p.activo ? "" : "opacity-55"}`}
            >
              <TableCell className={`${TD} text-ink-dim font-mono text-[11px]`}>
                {p.codigo_interno}
              </TableCell>
              <TableCell className={TD}>
                <span className="text-ink-primary font-semibold">{p.nombre}</span>
                {p.descripcion ? (
                  <span className="text-ink-faint block max-w-md truncate text-[11px]">
                    {p.descripcion}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className={`${TD} text-ink-dim`}>{p.categoria ?? "—"}</TableCell>
              <TableCell className={`${TD} text-ink-body text-right font-mono tabular-nums`}>
                $ {precioFmt.format(p.precio)}
              </TableCell>
              <TableCell className={`${TD} text-ink-dim text-right font-mono tabular-nums`}>
                {p.stock}
              </TableCell>
              <TableCell className={TD}>
                {p.activo ? (
                  <span className="text-ok bg-ok/10 border-ok/28 inline-flex items-center rounded-md border px-[7px] py-[2.5px] text-[10px] font-semibold">
                    Activo
                  </span>
                ) : (
                  <span className="text-ink-faint border-line-control inline-flex items-center rounded-md border px-[7px] py-[2.5px] text-[10px] font-semibold">
                    Inactivo
                  </span>
                )}
              </TableCell>
              {isAdmin ? (
                <TableCell className={TD}>
                  <ProductoRowActions
                    producto={p}
                    onUpdate={onUpdate}
                    onToggleActivo={onToggleActivo}
                  />
                </TableCell>
              ) : null}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
