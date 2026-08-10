import { Inventory2 } from "@/components/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/EmptyState";
import { ProductoRowActions } from "./ProductoRowActions";
import type {
  SetProductoActivoInput,
  UpdateProductoInput,
} from "@/lib/validation/productos.schema";
import type { ActionResult } from "@/types/inbox";
import type { Producto } from "@/types/entities";

const precioFmt = new Intl.NumberFormat("es", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const TH =
  "text-ink-faint px-5 py-2.5 font-mono text-[9px] font-semibold tracking-[0.13em] uppercase";
const TD = "px-5 py-[9px]";

export function ProductosTable({
  productos,
  isAdmin,
  onUpdate,
  onToggleActivo,
}: {
  productos: Producto[];
  isAdmin: boolean;
  onUpdate: (input: UpdateProductoInput) => Promise<ActionResult>;
  onToggleActivo: (input: SetProductoActivoInput) => Promise<ActionResult>;
}) {
  if (productos.length === 0) {
    return (
      <EmptyState
        icon={<Inventory2 size={34} strokeWidth={1.4} />}
        title="Sin productos"
        description="Cargá el catálogo a mano o importá un CSV para que el agente pueda cotizar."
      />
    );
  }

  return (
    <Table className="text-[12.5px]">
      <TableHeader>
        <TableRow className="border-line-layout hover:bg-transparent">
          <TableHead className={TH}>Código</TableHead>
          <TableHead className={TH}>Nombre</TableHead>
          <TableHead className={TH}>Categoría</TableHead>
          <TableHead className={`${TH} text-right`}>Precio</TableHead>
          <TableHead className={`${TH} text-right`}>Stock</TableHead>
          <TableHead className={TH}>Estado</TableHead>
          {isAdmin ? <TableHead className={`${TH} w-44 text-right`}>Acciones</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {productos.map((p) => (
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
        ))}
      </TableBody>
    </Table>
  );
}
