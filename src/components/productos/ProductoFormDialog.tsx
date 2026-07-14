"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ComponentProps } from "react";
import type { Producto } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

export interface ProductoFormValues {
  codigo_interno: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  sku_proveedor: string | null;
  precio: number;
  stock: number;
}

function textOrNull(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

export function ProductoFormDialog({
  title,
  description,
  triggerLabel,
  triggerVariant = "default",
  initial,
  onSubmit,
}: {
  title: string;
  description: string;
  triggerLabel: string;
  triggerVariant?: ComponentProps<typeof Button>["variant"];
  // Presente = modo edición (codigo_interno inmutable, precargado).
  initial?: Producto;
  onSubmit: (values: ProductoFormValues) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    const values: ProductoFormValues = {
      codigo_interno: initial
        ? initial.codigo_interno
        : String(formData.get("codigo_interno") ?? "").trim(),
      nombre: String(formData.get("nombre") ?? "").trim(),
      descripcion: textOrNull(formData, "descripcion"),
      categoria: textOrNull(formData, "categoria"),
      sku_proveedor: textOrNull(formData, "sku_proveedor"),
      precio: Number(formData.get("precio")),
      stock: Number(formData.get("stock")),
    };
    startTransition(async () => {
      const result = await onSubmit(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(initial ? "Producto actualizado" : "Producto creado");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={triggerVariant} size="sm" />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Código interno *</span>
            <Input
              name="codigo_interno"
              required
              maxLength={64}
              defaultValue={initial?.codigo_interno ?? ""}
              disabled={Boolean(initial) || isPending}
              className="font-mono"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Nombre *</span>
            <Input
              name="nombre"
              required
              maxLength={200}
              defaultValue={initial?.nombre ?? ""}
              disabled={isPending}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Descripción</span>
            <Textarea
              name="descripcion"
              maxLength={1000}
              rows={2}
              defaultValue={initial?.descripcion ?? ""}
              disabled={isPending}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Categoría</span>
              <Input
                name="categoria"
                maxLength={100}
                defaultValue={initial?.categoria ?? ""}
                disabled={isPending}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">SKU proveedor</span>
              <Input
                name="sku_proveedor"
                maxLength={100}
                defaultValue={initial?.sku_proveedor ?? ""}
                disabled={isPending}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Precio *</span>
              <Input
                name="precio"
                type="number"
                required
                min="0"
                step="0.01"
                defaultValue={initial?.precio ?? ""}
                disabled={isPending}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Stock *</span>
              <Input
                name="stock"
                type="number"
                required
                min="0"
                step="1"
                defaultValue={initial?.stock ?? ""}
                disabled={isPending}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
