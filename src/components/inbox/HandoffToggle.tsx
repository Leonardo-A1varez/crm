"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ToggleHandoffInput } from "@/lib/validation/inbox.schema";
import type { ActionResult } from "@/types/inbox";
import type { UUID } from "@/types/entities";

export function HandoffToggle({
  leadId,
  sessionId,
  iaPausada,
  onToggle,
}: {
  leadId: UUID;
  sessionId: UUID;
  iaPausada: boolean;
  onToggle: (input: ToggleHandoffInput) => Promise<ActionResult>;
}) {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const result = await onToggle({
        leadId,
        sessionId,
        action: iaPausada ? "resume" : "pause",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(iaPausada ? "IA reanudada" : "IA pausada — tomás vos la conversación");
    });
  };

  return (
    // El chip dice el estado, no la acción: es el mismo dato que el badge "IA
    // pausada" de la lista, y en verde un botón que dice "Pausar IA" se lee al
    // revés de lo que pasa. La acción va en el `title`.
    <button
      type="button"
      aria-pressed={iaPausada}
      disabled={isPending}
      onClick={handleClick}
      title={iaPausada ? "Reanudar la IA" : "Pausar la IA y tomar la conversación"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-semibold transition-colors disabled:opacity-60",
        iaPausada ? "text-warn bg-warn/10 border-warn/28" : "text-ok bg-ok/10 border-ok/28",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          iaPausada ? "bg-warn" : "bg-ok animate-pulse-dot",
        )}
      />
      {iaPausada ? "IA pausada" : "IA activa"}
    </button>
  );
}
