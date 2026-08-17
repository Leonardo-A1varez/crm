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
import type { ComponentProps } from "react";
import type { ActionResult } from "@/types/inbox";
import type { Campania } from "@/types/entities";

function aInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface CampaniaFormValues {
  nombre: string;
  desde: string;
  hasta: string;
}

export function CampaniaFormDialog({
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
  initial?: Campania;
  onSubmit: (values: CampaniaFormValues) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    const values: CampaniaFormValues = {
      nombre: String(formData.get("nombre") ?? "").trim(),
      desde: String(formData.get("desde") ?? ""),
      hasta: String(formData.get("hasta") ?? ""),
    };
    startTransition(async () => {
      const result = await onSubmit(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(initial ? "Campaña actualizada" : "Campaña creada");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={triggerVariant} size="sm" />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
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
              maxLength={60}
              defaultValue={initial?.nombre ?? ""}
              disabled={isPending}
              autoComplete="off"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Desde *</span>
              <Input
                type="date"
                name="desde"
                required
                defaultValue={initial ? aInputDate(initial.desde) : ""}
                disabled={isPending}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Hasta *</span>
              <Input
                type="date"
                name="hasta"
                required
                defaultValue={initial ? aInputDate(initial.hasta) : ""}
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
