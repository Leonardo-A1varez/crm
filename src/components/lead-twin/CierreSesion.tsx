"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { AutoAwesome, Close, TaskAlt, Warning } from "@/components/icons";
import { ChipProcedencia } from "@/components/lead-twin/ChipProcedencia";
import { MOTIVO_LABEL } from "@/lib/ui/motivo-perdida";
import { MOTIVO_PERDIDA } from "@/types/domain";
import type { CloseSessionInput } from "@/lib/validation/inbox.schema";
import type { MotivoPerdida } from "@/types/domain";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * Aviso de irreversibilidad. Va en los dos pasos, arriba del botón que confirma
 * y no después de haberlo apretado: cerrar la sesión la saca del inbox, deja al
 * lead sin sesión activa y arranca la purga a los 29 días, y nada de eso se
 * deshace desde el panel. Quien lo lee todavía puede no hacerlo.
 */
function AvisoCierre() {
  return (
    <p className="text-ink-warm-dim border-warn/24 bg-warn/7 flex items-start gap-1.5 rounded-[8px] border p-2 text-[10px] leading-snug">
      <Warning size={12} className="text-warn mt-[1px] shrink-0" />
      <span>
        Se cierra la sesión y el lead sale del inbox. No se puede reabrir desde acá, y el historial
        se purga a los 29 días.
      </span>
    </p>
  );
}

/**
 * El cierre del embudo en dos pasos: primero cómo terminó, y solo si se perdió,
 * por qué.
 *
 * Es el flujo que abre el segmento "Cerrado" del rail, que dejó de mover la
 * etapa directo. La razón es que "cerrado" nunca fue una etapa más: es el
 * momento en que la sesión deja de estar abierta, y esa fila necesita dos datos
 * que ninguna otra etapa pide —el resultado y, si se perdió, el motivo—.
 *
 * Dos pasos y no un formulario con todo junto: elegir "Ganado" no tiene que
 * pagar el precio de mirar cinco motivos que no le corresponden, que es lo que
 * hacía el diálogo de cierre viejo con su `<select>` condicional.
 *
 * Mismo lenguaje que el selector de etiquetas y el `+` de contacto: panel
 * flotante sobre la sección, `useCerrarAlSalir` en el contenedor de arriba, y
 * ningún botón "Cerrar" propio —se sale con Escape, clickeando afuera o con
 * "Cancelar"—.
 */
export function CierreSesion({
  leadId,
  sessionId,
  motivoPropuesto,
  onCerrarSesion,
  onSalir,
}: {
  leadId: UUID;
  sessionId: UUID;
  /**
   * Motivo que dejó propuesto el extractor, si dejó alguno. Se preselecciona y
   * se dice quién lo propuso; el vendedor confirma o elige otro.
   */
  motivoPropuesto: MotivoPerdida | null;
  onCerrarSesion: (input: CloseSessionInput) => Promise<ActionResult>;
  /** Cierra el popover sin decidir nada. */
  onSalir: () => void;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<"resultado" | "motivo">("resultado");
  const [motivo, setMotivo] = useState<MotivoPerdida | null>(motivoPropuesto);
  const [isPending, startTransition] = useTransition();

  const confirmar = (input: CloseSessionInput) => {
    if (isPending) return;
    startTransition(async () => {
      const r = await onCerrarSesion(input);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Sesión cerrada");
      onSalir();
      // La sesión dejó de estar activa: quedarse en el detalle mostraría el
      // vacío de "sin sesión". El inbox es donde está el trabajo que sigue.
      router.push("/inbox");
    });
  };

  if (paso === "resultado") {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-ink-secondary text-[11.5px] font-semibold">
          ¿Cómo terminó esta venta?
        </span>
        <AvisoCierre />
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={isPending}
            onClick={() => confirmar({ leadId, sessionId, resultado: "exito" })}
            className="text-ok bg-ok/10 border-ok/28 hover:bg-ok/18 flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border px-2 py-[7px] text-[11.5px] font-semibold transition-colors disabled:opacity-50"
          >
            <TaskAlt size={13} className="shrink-0" />
            Ganado
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setPaso("motivo")}
            className="text-danger bg-danger/10 border-danger/28 hover:bg-danger/18 flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border px-2 py-[7px] text-[11.5px] font-semibold transition-colors disabled:opacity-50"
          >
            <Close size={13} className="shrink-0" />
            Perdido
          </button>
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={onSalir}
          className="text-ink-dim self-start text-[10.5px] font-medium hover:underline disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-ink-secondary text-[11.5px] font-semibold">¿Por qué se perdió?</span>
        {motivoPropuesto ? (
          <ChipProcedencia
            Icon={AutoAwesome}
            className="text-brand-hover bg-brand/12"
            titulo="Lo propuso el extractor a partir de la conversación. Confirmalo o elegí otro."
          >
            Propuesto por IA
          </ChipProcedencia>
        ) : null}
      </div>

      {/* Radiogroup y no una lista de botones que confirman al click: el motivo
          preseleccionado por la IA tiene que poder mirarse antes de aceptarlo, y
          un click que ya cierra la sesión no deja mirar nada. */}
      <div role="radiogroup" aria-label="Motivo de la pérdida" className="flex flex-col gap-[3px]">
        {MOTIVO_PERDIDA.map((m) => {
          const elegido = m === motivo;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={elegido}
              disabled={isPending}
              onClick={() => setMotivo(m)}
              className={
                elegido
                  ? "text-danger bg-danger/12 border-danger/30 rounded-[7px] border px-2 py-[5px] text-left text-[11.5px] font-semibold disabled:opacity-50"
                  : "text-ink-secondary hover:bg-surface-card border-line-control rounded-[7px] border px-2 py-[5px] text-left text-[11.5px] transition-colors disabled:opacity-50"
              }
            >
              {MOTIVO_LABEL[m]}
            </button>
          );
        })}
      </div>

      <AvisoCierre />

      <div className="flex gap-1.5">
        <button
          type="button"
          // El motivo obligatorio no lo sostiene este `disabled`: lo sostienen
          // `CloseSessionSchema` y el service. Acá solo evita el click inútil.
          disabled={isPending || motivo === null}
          onClick={() =>
            motivo !== null &&
            confirmar({ leadId, sessionId, resultado: "perdido", motivoPerdida: motivo })
          }
          className="bg-danger text-background rounded-[7px] px-2 py-[3px] text-[10.5px] font-semibold disabled:opacity-50"
        >
          {isPending ? "Cerrando…" : "Confirmar pérdida"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setPaso("resultado")}
          className="text-ink-dim border-line-control rounded-[7px] border px-2 py-[3px] text-[10.5px] font-semibold disabled:opacity-50"
        >
          Volver
        </button>
      </div>
    </div>
  );
}
