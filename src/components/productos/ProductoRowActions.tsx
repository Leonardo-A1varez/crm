"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProductoFormDialog } from "./ProductoFormDialog";
import type { ProductoFormValues } from "./ProductoFormDialog";
import type { Producto } from "@/types/entities";
import type { UpdateProductoInput } from "@/lib/validation/productos.schema";
import type { SetProductoActivoInput } from "@/lib/validation/productos.schema";
import type { ActionResult } from "@/types/inbox";

export function ProductoRowActions({
  producto,
  onUpdate,
  onToggleActivo,
}: {
  producto: Producto;
  onUpdate: (input: UpdateProductoInput) => Promise<ActionResult>;
  onToggleActivo: (input: SetProductoActivoInput) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const update = (values: ProductoFormValues): Promise<ActionResult> =>
    onUpdate({
      id: producto.id,
      nombre: values.nombre,
      descripcion: values.descripcion,
      categoria: values.categoria,
      sku_proveedor: values.sku_proveedor,
      precio: values.precio,
      stock: values.stock,
    });

  const toggle = () => {
    startTransition(async () => {
      const result = await onToggleActivo({ id: producto.id, activo: !producto.activo });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(producto.activo ? "Producto desactivado" : "Producto activado");
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <ProductoFormDialog
        title={`Editar ${producto.codigo_interno}`}
        description="El código interno no se puede cambiar."
        triggerLabel="Editar"
        triggerVariant="outline"
        initial={producto}
        onSubmit={update}
      />
      <Button variant="ghost" size="sm" onClick={toggle} disabled={isPending}>
        {producto.activo ? "Desactivar" : "Activar"}
      </Button>
    </div>
  );
}
