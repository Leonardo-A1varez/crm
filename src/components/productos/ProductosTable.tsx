import { Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
        icon={<Package className="h-10 w-10" />}
        title="Sin productos"
        description="Cargá el catálogo a mano o importá un CSV para que el agente pueda cotizar."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Código</TableHead>
          <TableHead>Nombre</TableHead>
          <TableHead>Categoría</TableHead>
          <TableHead className="text-right">Precio</TableHead>
          <TableHead className="text-right">Stock</TableHead>
          <TableHead>Estado</TableHead>
          {isAdmin ? <TableHead className="w-44 text-right">Acciones</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {productos.map((p) => (
          <TableRow key={p.id} className={p.activo ? undefined : "opacity-60"}>
            <TableCell className="font-mono text-xs">{p.codigo_interno}</TableCell>
            <TableCell>
              <span className="font-medium">{p.nombre}</span>
              {p.descripcion ? (
                <span className="text-muted-foreground block max-w-md truncate text-xs">
                  {p.descripcion}
                </span>
              ) : null}
            </TableCell>
            <TableCell className="text-muted-foreground">{p.categoria ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">
              $ {precioFmt.format(p.precio)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{p.stock}</TableCell>
            <TableCell>
              <Badge variant={p.activo ? "default" : "outline"}>
                {p.activo ? "Activo" : "Inactivo"}
              </Badge>
            </TableCell>
            {isAdmin ? (
              <TableCell>
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
