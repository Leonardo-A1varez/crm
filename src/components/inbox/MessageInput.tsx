"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SendMessageInput } from "@/lib/validation/inbox.schema";
import type { Canal } from "@/types/domain";
import type { ActionResult } from "@/types/inbox";
import type { UUID } from "@/types/entities";

/**
 * Input de envío manual del vendedor. Enter envía, Shift+Enter hace salto de
 * línea (patrón WhatsApp Web). Double-submit mitigado con disabled+isPending.
 */
export function MessageInput({
  leadId,
  sessionId,
  canal,
  onSend,
}: {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  onSend: (input: SendMessageInput) => Promise<ActionResult>;
}) {
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed || isPending) return;
    startTransition(async () => {
      const result = await onSend({ leadId, sessionId, canal, body: trimmed });
      if (result.ok) {
        setBody("");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="border-border flex items-end gap-2 border-t p-3">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Escribí un mensaje… (Enter envía)"
        aria-label="Mensaje"
        disabled={isPending}
        className="max-h-40 min-h-10 flex-1 resize-none"
      />
      <Button onClick={submit} disabled={isPending || body.trim().length === 0}>
        {isPending ? "Enviando…" : "Enviar"}
      </Button>
    </div>
  );
}
