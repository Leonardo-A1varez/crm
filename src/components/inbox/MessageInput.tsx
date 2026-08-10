"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { LockClock, Schedule, SendIcon } from "@/components/icons";
import { Textarea } from "@/components/ui/textarea";
import type { SendMessageInput } from "@/lib/validation/inbox.schema";
import { restanteLegible, type Ventana } from "@/lib/ventana";
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
  ventana,
  onSend,
}: {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  ventana: Ventana;
  onSend: (input: SendMessageInput) => Promise<ActionResult>;
}) {
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  const cerrada = ventana.estado === "cerrada";

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed || isPending || cerrada) return;
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
      {cerrada ? (
        <div className="text-warn bg-warn/10 border-warn/28 mb-2 flex items-start gap-2 rounded-[10px] border px-[11px] py-2 text-[11.5px]">
          <LockClock size={14} className="mt-px shrink-0" />
          <span>
            La ventana de 24 h se cerró. WhatsApp solo acepta plantillas aprobadas hasta que el
            cliente vuelva a escribir.
          </span>
        </div>
      ) : null}
      {ventana.estado === "por-vencer" ? (
        <div className="text-caution mb-2 flex items-center gap-1.5 text-[11px]">
          <Schedule size={13} className="shrink-0" />
          Quedan {restanteLegible(ventana.restanteMs)} de la ventana de 24 h.
        </div>
      ) : null}
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
          placeholder={cerrada ? "Ventana cerrada" : "Escribí un mensaje…"}
          aria-label="Mensaje"
          disabled={isPending || cerrada}
          className="text-ink-body placeholder:text-ink-ghost max-h-40 min-h-8 flex-1 resize-none rounded-none border-0 bg-transparent p-0 text-[12.5px] focus-visible:ring-0 disabled:bg-transparent md:text-[12.5px] dark:bg-transparent dark:disabled:bg-transparent"
        />
        <button
          type="button"
          onClick={submit}
          disabled={isPending || cerrada || body.trim().length === 0}
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
