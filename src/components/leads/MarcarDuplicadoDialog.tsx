"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { UUID } from "@/types/entities";
import type { LeadListItem } from "@/types/leads";
import type { ActionResult } from "@/types/inbox";

export function MarcarDuplicadoDialog({
  leadId,
  onSearch,
  onCreate,
}: {
  leadId: UUID;
  onSearch: (input: {
    q: string;
  }) => Promise<{ ok: true; items: LeadListItem[] } | { ok: false; error: string }>;
  onCreate: (input: { leadId: UUID; otherLeadId: UUID }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LeadListItem[]>([]);
  const [buscado, setBuscado] = useState(false);
  const [isPending, startTransition] = useTransition();

  const buscar = () => {
    startTransition(async () => {
      const r = await onSearch({ q });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setItems(r.items.filter((i) => i.leadId !== leadId));
      setBuscado(true);
    });
  };

  const marcar = (otherLeadId: UUID) => {
    startTransition(async () => {
      const r = await onCreate({ leadId, otherLeadId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Duplicado marcado — aparece en la lista de pendientes.");
      setOpen(false);
      setQ("");
      setItems([]);
      setBuscado(false);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQ("");
          setItems([]);
          setBuscado(false);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Marcar duplicado de…
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar duplicado</DialogTitle>
          <DialogDescription>
            Buscá el otro lead que es la misma persona. El par queda pendiente de revisión.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && q.trim() && buscar()}
            placeholder="Nombre o teléfono…"
            disabled={isPending}
            aria-label="Buscar lead duplicado"
          />
          <Button onClick={buscar} disabled={isPending || q.trim() === ""} variant="outline">
            Buscar
          </Button>
        </div>
        {items.length > 0 ? (
          <ul className="divide-border max-h-60 divide-y overflow-y-auto">
            {items.map((i) => (
              <li key={i.leadId} className="flex items-center gap-2 py-2 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{i.nombre}</span>
                  {/* Crudo a propósito, como en DuplicadosSection: el número se
                      compara con el del lead abierto para ver si es el mismo, y
                      el separador de país estorba esa comparación. */}
                  <span className="text-muted-foreground font-mono text-xs">{i.telefono}</span>
                </div>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => marcar(i.leadId)}
                  disabled={isPending}
                >
                  Marcar
                </Button>
              </li>
            ))}
          </ul>
        ) : buscado && items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Sin resultados.</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
