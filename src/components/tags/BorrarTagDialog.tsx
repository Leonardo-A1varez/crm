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
import { TagBadge } from "./TagBadge";
import type { BorrarTagResult, TagListItem } from "@/types/tags";

function frase(leads: number): string {
  if (leads === 0) return "No está colgada en ningún lead.";
  if (leads === 1) return "Se va a quitar del lead que la tiene.";
  return `Se va a quitar de los ${leads} leads que la tienen.`;
}

/**
 * Confirmación del borrado. Es un diálogo propio y no un `confirm()` porque lo
 * que hay que mostrar antes de decidir es el impacto: borrar una etiqueta la
 * saca de todos los leads que la tenían y eso no se deshace — no existe
 * "desactivar" (la tabla `tags` no tiene columna de activo).
 */
export function BorrarTagDialog({
  tag,
  onBorrar,
}: {
  tag: TagListItem;
  onBorrar: () => Promise<BorrarTagResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const borrar = () => {
    startTransition(async () => {
      const result = await onBorrar();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // El conteo del toast es el que valía al borrar, no el del último render:
      // entre que se abrió el diálogo y se confirmó, otro pudo mover etiquetas.
      toast.success(
        result.leadsAfectados === 0
          ? `Etiqueta «${result.nombre}» borrada`
          : `Etiqueta «${result.nombre}» borrada y quitada de ${result.leadsAfectados} lead${result.leadsAfectados === 1 ? "" : "s"}`,
      );
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Borrar</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Borrar etiqueta</DialogTitle>
          <DialogDescription>
            {frase(tag.leadsUsando)} La acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>

        <div className="border-line-input flex items-center gap-2.5 rounded-[9px] border px-3 py-2.5">
          <TagBadge nombre={tag.nombre} color={tag.color} />
          <span className="text-ink-faint font-mono text-[10.5px] tabular-nums">
            {tag.leadsUsando} lead{tag.leadsUsando === 1 ? "" : "s"}
          </span>
        </div>

        {tag.leadsUsando > 0 ? (
          <p className="text-warn text-[11.5px] leading-relaxed">
            No hay forma de desactivarla en lugar de borrarla. Volver atrás significa crear la
            etiqueta de nuevo y colgarla lead por lead desde la conversación.
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={borrar} disabled={isPending}>
            {isPending ? "Borrando…" : "Borrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
