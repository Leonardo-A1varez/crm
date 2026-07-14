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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MOTIVO_PERDIDA } from "@/types/domain";
import type { CloseSessionInput } from "@/lib/validation/inbox.schema";
import type { MotivoPerdida, Resultado } from "@/types/domain";
import type { ActionResult } from "@/types/inbox";
import type { UUID } from "@/types/entities";

const MOTIVO_LABEL: Record<MotivoPerdida, string> = {
  precio: "Precio",
  stock: "Sin stock",
  tiempo: "Tiempos de entrega",
  no_responde: "No responde",
  otro: "Otro",
};

// `items` en Root: Base UI lo usa para que SelectValue muestre label, no el value raw.
const RESULTADO_ITEMS = { exito: "Éxito (venta concretada)", perdido: "Perdido" };

export function CloseSessionButton({
  leadId,
  sessionId,
  onClose,
}: {
  leadId: UUID;
  sessionId: UUID;
  onClose: (input: CloseSessionInput) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [resultado, setResultado] = useState<Resultado>("exito");
  const [motivo, setMotivo] = useState<MotivoPerdida | null>(null);
  const [isPending, startTransition] = useTransition();

  const confirm = () => {
    startTransition(async () => {
      const result = await onClose({
        leadId,
        sessionId,
        resultado,
        motivoPerdida: resultado === "perdido" ? (motivo ?? undefined) : undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Sesión cerrada");
      setOpen(false);
      router.push("/inbox");
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>
        Cerrar sesión
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cerrar sesión del lead</DialogTitle>
          <DialogDescription>
            La sesión termina con un resultado. El historial se purga a los 29 días del cierre.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Resultado</span>
            <Select
              items={RESULTADO_ITEMS}
              value={resultado}
              onValueChange={(v) => setResultado(v as Resultado)}
              disabled={isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exito">Éxito (venta concretada)</SelectItem>
                <SelectItem value="perdido">Perdido</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {resultado === "perdido" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Motivo (opcional)</span>
              <Select
                items={MOTIVO_LABEL}
                value={motivo}
                onValueChange={(v) => setMotivo(v as MotivoPerdida)}
                disabled={isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Elegí un motivo" />
                </SelectTrigger>
                <SelectContent>
                  {MOTIVO_PERDIDA.map((m) => (
                    <SelectItem key={m} value={m}>
                      {MOTIVO_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={isPending}>
            {isPending ? "Cerrando…" : "Confirmar cierre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
