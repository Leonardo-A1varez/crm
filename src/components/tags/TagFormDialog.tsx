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
import { ColorPicker } from "./ColorPicker";
import { TagBadge } from "./TagBadge";
import type { ComponentProps } from "react";
import type { ActionResult } from "@/types/inbox";
import type { TagListItem } from "@/types/tags";

export interface TagFormValues {
  nombre: string;
  color: string;
  descripcion: string | null;
}

export function TagFormDialog({
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
  /** Presente = modo edición (campos precargados). */
  initial?: TagListItem;
  onSubmit: (values: TagFormValues) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Solo para la vista previa: el valor que se guarda sale del FormData.
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [color, setColor] = useState(initial?.color ?? "");

  // El formulario se desmonta al cerrar y sus inputs vuelven al valor inicial,
  // pero la vista previa vive acá: sin este reset la próxima apertura mostraría
  // el badge de lo último que se tipeó sobre campos ya vacíos.
  const cambiarApertura = (abierto: boolean) => {
    setOpen(abierto);
    if (!abierto) {
      setNombre(initial?.nombre ?? "");
      setColor(initial?.color ?? "");
    }
  };

  const submit = (formData: FormData) => {
    const descripcion = String(formData.get("descripcion") ?? "").trim();
    const values: TagFormValues = {
      nombre: String(formData.get("nombre") ?? "").trim(),
      color: String(formData.get("color") ?? ""),
      descripcion: descripcion === "" ? null : descripcion,
    };
    startTransition(async () => {
      const result = await onSubmit(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(initial ? "Etiqueta actualizada" : "Etiqueta creada");
      cambiarApertura(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={cambiarApertura}>
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
            <span className="text-muted-foreground text-xs">Nombre *</span>
            <Input
              name="nombre"
              required
              minLength={2}
              maxLength={40}
              defaultValue={initial?.nombre ?? ""}
              onChange={(e) => setNombre(e.currentTarget.value)}
              disabled={isPending}
              autoComplete="off"
            />
          </label>

          <ColorPicker
            name="color"
            defaultValue={initial?.color}
            disabled={isPending}
            onValueChange={setColor}
          />

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Descripción</span>
            <Textarea
              name="descripcion"
              maxLength={200}
              rows={2}
              defaultValue={initial?.descripcion ?? ""}
              disabled={isPending}
            />
          </label>

          {/* El color solo se juzga sobre el fondo real y en el tamaño real. */}
          <div className="border-line-input flex items-center gap-2 rounded-[9px] border border-dashed px-3 py-2.5">
            <span className="text-ink-faint font-mono text-[9px] font-semibold tracking-[0.13em] uppercase">
              Se ve así
            </span>
            {nombre.trim() !== "" && color !== "" ? (
              <TagBadge nombre={nombre.trim()} color={color} />
            ) : (
              <span className="text-ink-ghost text-[11px]">Elegí nombre y color</span>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => cambiarApertura(false)}
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
