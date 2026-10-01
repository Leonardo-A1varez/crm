"use client";

import { useId, useState } from "react";
import { BotonAbrirWhatsApp } from "@/components/whatsapp/BotonAbrirWhatsApp";
import { SelectorVistaCentro } from "@/components/whatsapp/SelectorVistaCentro";
import type { ModoCentro } from "@/components/whatsapp/usePreferenciaVistaCentro";
import { Button } from "@/components/ui/button";
import { RECORTE_MAXIMO, RECORTE_MINIMO, RECORTE_PASO } from "@/lib/whatsapp/chat";
import { cn } from "@/lib/utils";
import type { VistaWhatsApp } from "@/types/crm-escritorio";

/**
 * La barra que va arriba del centro del Inbox cuando la conversación se puede
 * ver en WhatsApp Web: el selector WhatsApp Web / Hilo del CRM y, solo en el
 * modo WhatsApp Web, recargar, mostrar WhatsApp completo y ajustar el recorte.
 * En el modo hilo queda únicamente el selector.
 *
 * El ajuste del recorte se despliega dentro de la barra y no en un popover a
 * propósito: la vista nativa de WhatsApp se superpone al hueco que está justo
 * debajo, y todo lo que un popover dibujara sobre él quedaría tapado por
 * WhatsApp. Desplegada en línea, la barra crece, el hueco baja y se vuelve a
 * reportar solo.
 *
 * Los controles de vista solo tienen sentido dentro de la app de escritorio;
 * quien monta la barra decide cuándo mostrarla.
 */
export function BarraVistaWhatsApp({
  modo,
  onModo,
  vista,
  estado,
  interruptor = null,
  onCambiar,
  onRecargado,
}: {
  modo: ModoCentro;
  onModo: (modo: ModoCentro) => void;
  /** `null` mientras la app no contestó cuál es la vista actual. */
  vista: VistaWhatsApp | null;
  /** Lo que está pasando con el chat (abriendo, falló) o un error de la vista. */
  estado: { texto: string; esError: boolean } | null;
  /** Interruptor de modo del copiloto: solo se dibuja en el modo WhatsApp Web. */
  interruptor?: React.ReactNode;
  onCambiar: (cambios: Partial<VistaWhatsApp>) => void;
  onRecargado: () => void;
}) {
  const [ajustando, setAjustando] = useState(false);
  const idPanel = useId();
  const idRango = useId();
  const idAyuda = useId();
  const idCalibracion = useId();

  const enWhatsApp = modo === "whatsapp";
  const completo = vista?.completo ?? false;
  const recorte = vista?.recorteIzquierdo ?? RECORTE_MINIMO;
  const relleno = ((recorte - RECORTE_MINIMO) / (RECORTE_MAXIMO - RECORTE_MINIMO)) * 100;

  return (
    <div className="border-line-layout bg-surface-panel shrink-0 border-b">
      {/* Con wrap: a 520 de ancho el selector, "Abrir", el interruptor y "Ajustar
          recorte" no entran en una fila y los controles pasan a una segunda. */}
      <div className="flex min-h-[46px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <SelectorVistaCentro modo={modo} onCambiar={onModo} />
        {enWhatsApp ? (
          <>
            <BotonAbrirWhatsApp alRecargar={onRecargado} />
            <p
              role="status"
              className={cn(
                "min-w-0 flex-1 basis-[120px] truncate text-[11px]",
                estado?.esError ? "text-danger" : "text-ink-faint",
              )}
            >
              {estado?.texto}
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={completo}
              disabled={vista === null}
              onClick={() => onCambiar({ completo: !completo })}
              className="hover:bg-surface-hover focus-visible:ring-ring/50 flex h-7 shrink-0 items-center gap-2 rounded-[9px] px-2 transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:opacity-50"
            >
              <span
                aria-hidden
                className={cn(
                  "relative h-[17px] w-[30px] shrink-0 rounded-[20px] transition-colors duration-[160ms]",
                  completo ? "bg-brand" : "bg-line-control",
                )}
              >
                <span
                  className="absolute top-[2.5px] h-3 w-3 rounded-full bg-white transition-[left] duration-[160ms]"
                  style={{ left: completo ? "15.5px" : "2.5px" }}
                />
              </span>
              <span className="text-ink-secondary text-[11.5px] font-semibold whitespace-nowrap">
                Ver WhatsApp completo
              </span>
            </button>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={ajustando}
              aria-controls={idPanel}
              onClick={() => setAjustando((abierto) => !abierto)}
            >
              Ajustar recorte
            </Button>
            {interruptor ? <div className="ml-auto flex min-w-0">{interruptor}</div> : null}
          </>
        ) : null}
      </div>

      {enWhatsApp && ajustando ? (
        <div id={idPanel} className="border-line-layout border-t px-4 py-3">
          <div className="flex items-center gap-3">
            <label
              htmlFor={idRango}
              className="text-ink-secondary shrink-0 text-[11.5px] font-semibold"
            >
              Recorte izquierdo
            </label>
            <input
              id={idRango}
              type="range"
              min={RECORTE_MINIMO}
              max={RECORTE_MAXIMO}
              step={RECORTE_PASO}
              value={recorte}
              disabled={vista === null || completo}
              aria-describedby={`${idAyuda} ${idCalibracion}`}
              onChange={(e) => onCambiar({ recorteIzquierdo: Number(e.target.value) })}
              style={{
                background: `linear-gradient(to right, var(--color-brand-deep) 0%, var(--color-brand-hover) ${relleno}%, var(--color-line-control) ${relleno}%, var(--color-line-control) 100%)`,
              }}
              className="h-[5px] min-w-0 flex-1 appearance-none rounded-full disabled:opacity-50 [&::-moz-range-thumb]:h-[15px] [&::-moz-range-thumb]:w-[15px] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--color-surface-panel)] [&::-moz-range-thumb]:bg-[var(--color-brand-hover)] [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-[5px] [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-[15px] [&::-webkit-slider-thumb]:w-[15px] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-surface-panel)] [&::-webkit-slider-thumb]:bg-[var(--color-brand-hover)]"
            />
            <output
              htmlFor={idRango}
              className="text-ink-primary w-[64px] shrink-0 text-right font-mono text-[11.5px] tabular-nums"
            >
              {recorte} px
            </output>
          </div>
          <p id={idAyuda} className="text-ink-faint mt-2 text-[11px] text-pretty">
            Mové el corte hasta que desaparezca la lista de chats de WhatsApp.
            {completo ? " No se aplica mientras ves WhatsApp completo." : ""}
          </p>
          {vista?.calibrado === undefined ? null : (
            <p id={idCalibracion} className="text-ink-faint mt-1 text-[11px] text-pretty">
              {vista.calibrado
                ? `Guardado para este ancho de ventana (${vista.anchoArea} px).`
                : "Calculado a partir de otros anchos. Ajustalo si se ve la lista de WhatsApp."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
