"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
    <Button variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
      {iaPausada ? "Reanudar IA" : "Pausar IA"}
    </Button>
  );
}
