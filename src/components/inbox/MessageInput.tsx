"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SendIcon } from "@/components/icons";
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
    <div className="border-line-layout bg-surface-chat border-t px-[26px] py-3">
      <div className="border-line-input bg-surface-input flex items-end gap-2 rounded-[14px] border py-[9px] pr-[10px] pl-[14px]">
        {/* Los `dark:bg-input/30` y `disabled:bg-input/80` del primitivo de
            shadcn pintan un rectángulo adentro de la caja: hay que apagarlos
            con la misma variante, porque no colisionan con `bg-transparent`. */}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Escribí un mensaje…"
          aria-label="Mensaje"
          disabled={isPending}
          className="text-ink-body placeholder:text-ink-ghost max-h-40 min-h-8 flex-1 resize-none rounded-none border-0 bg-transparent p-0 text-[12.5px] focus-visible:ring-0 disabled:bg-transparent md:text-[12.5px] dark:bg-transparent dark:disabled:bg-transparent"
        />
        <button
          type="button"
          onClick={submit}
          disabled={isPending || body.trim().length === 0}
          aria-label="Enviar"
          className="bg-brand text-brand-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] transition-opacity disabled:opacity-45"
          style={{ boxShadow: "0 3px 12px rgba(240,138,29,.3)" }}
        >
          <SendIcon size={15} />
        </button>
      </div>
      <p className="text-ink-ghost mt-1.5 font-mono text-[10px]">
        Enter envía · ⇧Enter salto de línea
      </p>
    </div>
  );
}
