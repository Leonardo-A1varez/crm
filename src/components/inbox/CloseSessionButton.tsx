"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TaskAlt } from "@/components/icons";
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
import { MOTIVO_LABEL } from "@/lib/ui/motivo-perdida";
import { MOTIVO_PERDIDA } from "@/types/domain";
import type { CloseSessionInput } from "@/lib/validation/inbox.schema";
import type { MotivoPerdida, Resultado } from "@/types/domain";
import type { ActionResult } from "@/types/inbox";
import type { UUID } from "@/types/entities";

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

  // El motivo es obligatorio cuando se perdió: sin él no hay input que armar.
  // La regla la sostienen `CloseSessionSchema` y el service; esto solo evita
  // mandar un cierre que el server va a rechazar.
  const input: CloseSessionInput | null =
    resultado === "exito"
      ? { leadId, sessionId, resultado: "exito" }
      : motivo !== null
        ? { leadId, sessionId, resultado: "perdido", motivoPerdida: motivo }
        : null;

  const confirm = () => {
    if (input === null) return;
    startTransition(async () => {
      const result = await onClose(input);
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
      {/* Botón icónico de 30×30: el handoff lo saca del flujo de lectura del
          header a propósito — cerrar una sesión es raro y destructivo, no una
          acción que compita con el toggle de la IA. */}
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="text-ink-dim hover:bg-surface-elevated hover:text-ink-primary inline-flex h-[30px] w-[30px] items-center justify-center rounded-[9px] transition-colors"
          />
        }
      >
        <TaskAlt size={16} />
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
              <span className="text-muted-foreground text-xs">Motivo</span>
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
          <Button variant="destructive" onClick={confirm} disabled={isPending || input === null}>
            {isPending ? "Cerrando…" : "Confirmar cierre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
