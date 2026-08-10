"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { LockClock, Schedule, SendIcon } from "@/components/icons";
import { Textarea } from "@/components/ui/textarea";
import { esperaLegible } from "@/lib/triage";
import { cn } from "@/lib/utils";
import { estadoVentana, restanteLegible, VENTANA_MS, type Ventana } from "@/lib/ventana";
import type { SendMessageInput } from "@/lib/validation/inbox.schema";
import type { Canal } from "@/types/domain";
import type { ActionResult } from "@/types/inbox";
import type { UUID } from "@/types/entities";

/**
 * Barra de estado de la ventana de 24 h. Va arriba del input y no como error
 * después de enviar: es el punto del handoff — la restricción se ve antes de
 * escribir.
 */
function BarraVentana({ ventana }: { ventana: Ventana }) {
  const porVencer = ventana.estado === "por-vencer";
  const proporcion = Math.min(1, Math.max(0, ventana.restanteMs / VENTANA_MS));

  return (
    <div className="mb-2 flex items-center gap-2">
      <Schedule size={13} className={cn("shrink-0", porVencer ? "text-caution" : "text-ok")} />
      <span className={cn("font-mono text-[9.5px]", porVencer ? "text-caution" : "text-ok")}>
        Ventana de 24 h abierta · quedan {restanteLegible(ventana.restanteMs)}
      </span>
      <div className="bg-line-card h-[3px] w-full max-w-[130px] overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", porVencer ? "bg-caution" : "bg-ok")}
          style={{ width: `${proporcion * 100}%` }}
        />
      </div>
    </div>
  );
}

/** "hace 31h" contra el reloj actual. Envuelta para no llamar `Date.now` en el render. */
function desdeHace(iso: string): string {
  return esperaLegible(Date.now() - new Date(iso).getTime());
}

/**
 * Reemplazo del input cuando Meta ya no acepta texto libre. Es un bloque y no
 * un input deshabilitado a propósito: deshabilitado se lee como "algo se rompió",
 * y esto es una regla de la plataforma con una salida concreta.
 */
function VentanaCerrada({ ultimoEntranteIso }: { ultimoEntranteIso: string | null }) {
  return (
    // Fondo cálido oscuro del bloque de aviso
    // del diseño y solo aparece acá y en la tarjeta de cotización del Twin.
    <div className="border-warn/28 bg-surface-warm rounded-[14px] border px-[13px] py-3">
      <div className="flex items-center gap-2">
        <LockClock size={15} className="text-warn shrink-0" />
        <span className="text-warn text-[12px] font-semibold">Ventana de 24 h cerrada</span>
        {ultimoEntranteIso ? (
          <span className="text-ink-faint font-mono text-[9.5px]">
            último mensaje del cliente {desdeHace(ultimoEntranteIso)}
          </span>
        ) : null}
      </div>
      <p className="text-ink-dim mt-1.5 text-[11.5px]">
        Meta no permite mensajes libres. Solo plantillas aprobadas hasta que el cliente vuelva a
        escribir.
      </p>
    </div>
  );
}

/**
 * Input de envío manual del vendedor. Enter envía, Shift+Enter hace salto de
 * línea (patrón WhatsApp Web). Double-submit mitigado con disabled+isPending.
 */
export function MessageInput({
  leadId,
  sessionId,
  canal,
  ventana,
  ultimoEntranteIso,
  onSend,
}: {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  ventana: Ventana;
  /** `created_at` del último mensaje del cliente: desde ahí se mide la ventana. */
  ultimoEntranteIso: string | null;
  onSend: (input: SendMessageInput) => Promise<ActionResult>;
}) {
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  // La ventana se recalcula en cliente: con la pestaña abierta una hora, el
  // valor que renderizó el server miente. Hasta el primer tick vale el del
  // server —que es fresco en ese momento— y así la hidratación no discrepa.
  const [ahora, setAhora] = useState<Date | null>(null);
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const viva =
    ahora === null
      ? ventana
      : estadoVentana(ultimoEntranteIso === null ? null : new Date(ultimoEntranteIso), ahora);

  const cerrada = viva.estado === "cerrada";
  const abierta = viva.estado === "abierta" || viva.estado === "por-vencer";

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

  if (cerrada) {
    return (
      <div className="border-line-layout bg-surface-chat border-t px-[26px] py-3">
        <VentanaCerrada ultimoEntranteIso={ultimoEntranteIso} />
      </div>
    );
  }

  return (
    <div className="border-line-layout bg-surface-chat border-t px-[26px] py-3">
      {abierta ? <BarraVentana ventana={viva} /> : null}
      <div className="border-line-input bg-surface-input flex items-end gap-2 rounded-[14px] border py-[9px] pr-[10px] pl-[14px]">
        {/* Los `dark:bg-input/30` y `disabled:bg-input/80` del primitivo de
            shadcn pintan un rectángulo adentro de la caja: hay que apagarlos
            con la misma variante, porque no colisionan con `bg-transparent`. */}
        <div className="min-w-0 flex-1">
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
            className="text-ink-body placeholder:text-ink-ghost max-h-40 min-h-8 w-full resize-none rounded-none border-0 bg-transparent p-0 text-[12.5px] focus-visible:ring-0 disabled:bg-transparent md:text-[12.5px] dark:bg-transparent dark:disabled:bg-transparent"
          />
          <p className="text-ink-ghost font-mono text-[10px]">
            Enter envía · ⇧Enter salto de línea
          </p>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={isPending || body.trim().length === 0}
          aria-label="Enviar"
          className="bg-brand text-brand-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] transition-opacity disabled:opacity-45"
          style={{
            boxShadow: "0 3px 12px color-mix(in srgb, var(--color-brand-deep) 30%, transparent)",
          }}
        >
          <SendIcon size={15} />
        </button>
      </div>
    </div>
  );
}
