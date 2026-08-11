"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { Close, Schedule } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { MAX_LARGO_NOTA_RECORDATORIO } from "@/lib/validation/inbox.schema";
import type {
  CancelarRecordatorioInput,
  ProgramarRecordatorioInput,
} from "@/lib/validation/inbox.schema";
import type { SessionRecordatorio, UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * Los plazos que se ofrecen de un click.
 *
 * "En 2 días" primero y por default porque es el que pidió el dueño con esas
 * palabras: es el plazo del lead que dijo "lo pienso". Los otros dos existen
 * para el que dijo "llamame mañana" y para el que se fue de viaje.
 *
 * Horas y no días de calendario: sumar 48 horas al momento del click cae a la
 * misma hora del día, que es cuando el vendedor está atendiendo. Un "pasado
 * mañana a las 00:00" pondría el chip arriba de la bandeja de madrugada y lo
 * dejaría envejecido antes de que alguien lo vea.
 */
const PLAZOS = [
  { label: "En 2 días", horas: 48 },
  { label: "Mañana", horas: 24 },
  { label: "En 1 semana", horas: 24 * 7 },
] as const;

function enHoras(horas: number): Date {
  return new Date(Date.now() + horas * 60 * 60 * 1000);
}

/** "mié 13 ago, 15:40" — día y hora, que es lo que hace falta para confiar. */
function fechaLegible(d: Date): string {
  return format(d, "EEE d MMM, HH:mm", { locale: es });
}

/**
 * El seguimiento de la conversación: "volver a contactar en 2 días".
 *
 * Es la respuesta al pedido del dueño —sin esto, el lead que dijo "lo pienso"
 * desaparece— y hace exactamente una cosa: cuando la fecha llega, la
 * conversación sube al grupo "Requieren tu atención" del Inbox con su chip.
 * **No le manda nada al cliente**, y el bloque lo dice con todas las letras: es
 * la pregunta que el dueño no contestó, y un saliente automático que aparece
 * sin que nadie lo haya pedido es de las cosas que salen caras.
 *
 * Uno solo por conversación. Con uno vivo el bloque muestra ese y ofrece
 * cancelarlo; para cambiar la fecha se cancela y se pone de nuevo, que es más
 * corto de explicar que un editor de fechas y no deja dos citas compitiendo por
 * el mismo chip.
 */
export function RecordatorioSeguimiento({
  leadId,
  sessionId,
  recordatorio,
  onProgramar,
  onCancelar,
}: {
  leadId: UUID;
  sessionId: UUID;
  /** El vivo de esta sesión, o `null` si no hay ninguno. */
  recordatorio: SessionRecordatorio | null;
  onProgramar: (input: ProgramarRecordatorioInput) => Promise<ActionResult>;
  onCancelar: (input: CancelarRecordatorioInput) => Promise<ActionResult>;
}) {
  const [nota, setNota] = useState("");
  const [isPending, startTransition] = useTransition();

  const programar = (horas: number) => {
    if (isPending) return;
    startTransition(async () => {
      const r = await onProgramar({
        leadId,
        sessionId,
        recordarAt: enHoras(horas).toISOString(),
        nota,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setNota("");
      toast.success("Recordatorio programado");
    });
  };

  const cancelar = (recordatorioId: UUID) => {
    if (isPending) return;
    startTransition(async () => {
      const r = await onCancelar({ leadId, recordatorioId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Recordatorio cancelado");
    });
  };

  if (recordatorio) {
    const vencido = recordatorio.estado === "avisado";
    return (
      <div className="flex flex-col gap-3">
        <span className="text-ink-faint flex items-center gap-1.5">
          <Schedule size={12} className="shrink-0" />
          <Eyebrow>Seguimiento</Eyebrow>
        </span>

        <div className="border-info/24 bg-info/7 flex flex-col gap-2 rounded-[12px] border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-info text-[11.5px] font-semibold">
              {vencido ? "Toca volver a contactarlo" : "Volver a contactarlo"}
            </span>
            <MonoMeta className="shrink-0">
              <RelativeTime iso={recordatorio.recordar_at.toISOString()} />
            </MonoMeta>
          </div>

          <MonoMeta>{fechaLegible(recordatorio.recordar_at)}</MonoMeta>

          {recordatorio.nota.trim() !== "" ? (
            <p className="text-ink-secondary text-[11.5px] break-words whitespace-pre-wrap">
              {recordatorio.nota}
            </p>
          ) : null}

          {/* Lo primero que alguien se pregunta al ver esto es si el cliente se
              entera. La respuesta va en el bloque, no en la documentación. */}
          <p className="text-ink-ghost text-[10px] leading-relaxed">
            Cuando llegue la fecha, la conversación sube en el Inbox. No se le manda ningún mensaje
            al cliente. Si el cliente escribe antes, el recordatorio se cancela solo.
          </p>

          <button
            type="button"
            disabled={isPending}
            onClick={() => cancelar(recordatorio.id)}
            className="text-ink-dim border-line-control hover:text-ink-secondary flex items-center gap-1.5 self-start rounded-[7px] border px-2 py-[3px] text-[10.5px] font-semibold transition-colors disabled:opacity-50"
          >
            <Close size={11} className="shrink-0" />
            {isPending ? "Cancelando…" : "Cancelar recordatorio"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-ink-faint flex items-center gap-1.5">
        <Schedule size={12} className="shrink-0" />
        <Eyebrow>Seguimiento</Eyebrow>
      </span>

      <div className="flex flex-col gap-2">
        <input
          value={nota}
          disabled={isPending}
          maxLength={MAX_LARGO_NOTA_RECORDATORIO}
          aria-label="Nota del recordatorio"
          placeholder="Por qué volver (opcional)"
          onChange={(e) => setNota(e.target.value)}
          className="text-ink-body border-line-input bg-surface-input w-full rounded-[8px] border px-2 py-1 text-[11.5px] outline-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {PLAZOS.map(({ label, horas }) => (
            <button
              key={label}
              type="button"
              disabled={isPending}
              onClick={() => programar(horas)}
              className="text-ink-secondary hover:border-info/50 hover:text-info border-line-control rounded-[7px] border px-2 py-[4px] text-[10.5px] font-semibold transition-colors disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-ink-ghost text-[10px] leading-relaxed">
          Sube la conversación en el Inbox cuando llegue la fecha. No le escribe al cliente.
        </p>
      </div>
    </div>
  );
}
