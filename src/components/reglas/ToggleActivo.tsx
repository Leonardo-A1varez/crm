"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * Interruptor de activo/inactivo. Desactivar en vez de borrar es a propósito:
 * una regla apagada conserva su historial en `rule_executions`, y borrarla
 * dejaría huérfanas las respuestas que ya salieron por ella.
 */
export function ToggleActivo({
  id,
  activo,
  etiqueta,
  onToggle,
}: {
  id: UUID;
  activo: boolean;
  etiqueta: string;
  onToggle: (input: { id: UUID; valor: boolean }) => Promise<ActionResult>;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-pressed={activo}
      aria-label={`${activo ? "Desactivar" : "Activar"} ${etiqueta}`}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await onToggle({ id, valor: !activo });
          if (!r.ok) toast.error(r.error);
        })
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-[7px] py-[2.5px] text-[10px] font-semibold transition-colors disabled:opacity-60",
        activo ? "text-ok bg-ok/10 border-ok/28" : "text-ink-faint border-line-control",
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", activo ? "bg-ok" : "bg-ink-ghost")}
      />
      {activo ? "Activo" : "Inactivo"}
    </button>
  );
}
