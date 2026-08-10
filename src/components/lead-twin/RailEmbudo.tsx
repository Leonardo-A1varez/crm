"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { AltRoute, Edit } from "@/components/icons";
import { ChipProcedencia } from "@/components/lead-twin/ChipProcedencia";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { FUNNEL_STAGES, funnelStep, isDetour, stageColor, stageLabel } from "@/lib/ui/stage";
import type { MoverEtapaInput } from "@/lib/validation/inbox.schema";
import type { CurrentStage, EtapaEmbudo } from "@/types/domain";
import type { ProcedenciaCampo, UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * Gris del rail congelado. Va literal porque no hay token: es más claro que
 * `line-card` a propósito, para que el rail de un desvío se lea como una barra
 * inerte y no como progreso apagado.
 */
const RAIL_CONGELADO = "#3A3F49";

/**
 * Rail del embudo: 6 segmentos, los alcanzados en el color de la etapa, y cada
 * uno es el control que mueve la sesión a esa etapa.
 *
 * Los segmentos son los botones: no hay un selector aparte porque el rail ya
 * dice dónde está la conversación y agregarle un `<select>` al lado obligaría a
 * leer dos veces lo mismo. La barra mide 3,5 px, que no es un blanco clickeable,
 * así que el `<button>` se estira con padding vertical y lo compensa con margen
 * negativo: el área sensible es de 15 px y el dibujo no se mueve un pixel.
 *
 * En un desvío (`perdido`, `requiere_humano`) `funnelStep` es `null` porque esas
 * etapas no tienen posición. El rail no se apaga entero: se congela en gris
 * **hasta `etapa_alcanzada`**, que es hasta dónde llegó la conversación antes de
 * salirse. Desaparece el contador de pasos —no hay paso 7— y el chip de desvío
 * nombra dónde quedó frenada. Los segmentos siguen siendo clickeables ahí: sacar
 * del desvío a la etapa donde estaba la conversación es exactamente el caso en
 * el que una persona necesita el control.
 */
export function RailEmbudo({
  leadId,
  sessionId,
  stage,
  alcanzada,
  procedencia,
  onMover,
}: {
  leadId: UUID;
  sessionId: UUID;
  stage: CurrentStage;
  alcanzada: EtapaEmbudo;
  /** Marca de `current_stage`: si la puso una persona, se dice en el chip. */
  procedencia?: ProcedenciaCampo;
  onMover: (input: MoverEtapaInput) => Promise<ActionResult>;
}) {
  const [isPending, startTransition] = useTransition();

  const desvio = isDetour(stage);
  const paso = funnelStep(stage);
  // En un desvío el largo pintado sale de lo alcanzado; en el embudo, de la
  // etapa actual (que es lo alcanzado, salvo que el extractor haya retrocedido).
  const llenos = desvio ? (funnelStep(alcanzada) ?? 0) : (paso ?? 0);
  const color = desvio ? RAIL_CONGELADO : stageColor(stage);
  const aMano = procedencia?.por === "humano";

  const mover = (etapa: EtapaEmbudo) => {
    if (isPending || etapa === stage) return;
    startTransition(async () => {
      const r = await onMover({ leadId, sessionId, etapa });
      if (!r.ok) toast.error(r.error);
    });
  };

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-[18px] font-[680] tracking-[-0.02em]"
          style={{ color: stageColor(stage) }}
        >
          {stageLabel(stage)}
        </span>
        {paso !== null ? <MonoMeta>{`paso ${paso}/${FUNNEL_STAGES.length}`}</MonoMeta> : null}
      </div>

      {aMano ? (
        <ChipProcedencia
          Icon={Edit}
          className="text-info bg-info/12 self-start"
          titulo="La movió un humano; el extractor no la vuelve a tocar."
        >
          Etapa puesta por vos
        </ChipProcedencia>
      ) : null}

      <div className="flex flex-col gap-1">
        <div className="flex gap-[3px]">
          {FUNNEL_STAGES.map((etapa, i) => {
            const actual = etapa === stage;
            return (
              <button
                key={etapa}
                type="button"
                disabled={isPending || actual}
                // El actual no dice "Mover a": no mueve nada. Los demás nombran
                // el destino, que es lo único que un lector de pantalla puede
                // saber de una barra de 3 px sin texto.
                aria-label={
                  actual ? `Etapa actual: ${stageLabel(etapa)}` : `Mover a ${stageLabel(etapa)}`
                }
                aria-current={actual ? "step" : undefined}
                title={stageLabel(etapa)}
                onClick={() => mover(etapa)}
                className="group -my-[6px] flex-1 cursor-pointer rounded-full py-[6px] outline-none focus-visible:ring-1 focus-visible:ring-white/40 disabled:cursor-default"
              >
                <span
                  className={
                    i < llenos
                      ? "block h-[3.5px] rounded-full transition-opacity group-hover:opacity-70"
                      : "bg-line-card group-hover:bg-line-input block h-[3.5px] rounded-full transition-colors"
                  }
                  style={i < llenos ? { backgroundColor: color } : undefined}
                />
              </button>
            );
          })}
        </div>
        <div className="flex items-baseline justify-between">
          <MonoMeta className="text-ink-fainter text-[9px]">nuevo</MonoMeta>
          <MonoMeta className="text-ink-fainter text-[9px]">cerrado</MonoMeta>
        </div>
      </div>

      {desvio ? (
        <span className="text-special bg-special/9 inline-flex items-center gap-1.5 self-start rounded-md px-[7px] py-[3px] text-[10.5px] font-medium">
          <AltRoute size={12} className="shrink-0" />
          El embudo quedó frenado en «{stageLabel(alcanzada)}»
        </span>
      ) : null}
    </>
  );
}
