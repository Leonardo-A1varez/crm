"use client";

import { useCallback, useRef, useState } from "react";
import { KeyboardArrowDown } from "@/components/icons";
import { CHIP_BASE, CHIP_OFF, CHIP_ON } from "@/components/leads/ChipFiltro";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
import { motivoPerdidaLabel } from "@/lib/ui/motivo-perdida";
import { cn } from "@/lib/utils";
import type { MotivoPerdida } from "@/types/domain";

/**
 * El filtro de sesiones perdidas: un chip que enciende el recorte y abre, en el
 * mismo gesto, la lista de motivos registrados.
 *
 * Prenderlo filtra TODOS los perdidos: el motivo es un recorte opcional que se
 * elige adentro. Por eso el panel se abre solo pero se puede cerrar sin elegir
 * nada —Escape o click afuera— y el filtro queda puesto igual.
 *
 * La flecha aparece únicamente cuando está encendido. Apagado, el chip es un
 * toggle como todos los de la barra; encendido hace falta una forma de volver a
 * la lista que no sea apagarlo y prenderlo de nuevo.
 *
 * La lista son los motivos presentes en los datos, no el enum entero: ofrecer
 * "Stock" cuando ninguna sesión se perdió por stock es prometer un recorte que
 * devuelve vacío.
 */
export function FiltroPerdido({
  activo,
  motivo,
  motivos,
  onPrender,
  onApagar,
  onElegirMotivo,
}: {
  activo: boolean;
  motivo: MotivoPerdida | undefined;
  motivos: readonly MotivoPerdida[];
  onPrender: () => void;
  onApagar: () => void;
  onElegirMotivo: (motivo: MotivoPerdida | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const cerrar = useCallback(() => setAbierto(false), []);
  // El `ref` abarca el chip y el panel: clickear la flecha para cerrar no puede
  // contar como "click afuera", o cerraría dos veces y volvería a abrir.
  useCerrarAlSalir(abierto, panel, cerrar);

  function alternar() {
    if (activo) {
      onApagar();
      cerrar();
      return;
    }
    onPrender();
    setAbierto(true);
  }

  const OPCION_BASE = "rounded-[6px] px-1.5 py-1 text-left text-[11.5px] transition-colors";
  const OPCION_ON = "bg-surface-avatar text-ink-primary font-[550]";
  const OPCION_OFF = "text-ink-secondary hover:bg-surface-card";

  return (
    <div ref={panel} className="relative">
      {/* Contenedor sin padding: lo ponen los dos botones de adentro, que no
          pueden anidarse en un mismo `button`. */}
      <div className={cn(CHIP_BASE, activo ? CHIP_ON : CHIP_OFF, "gap-0 p-0")}>
        <button
          type="button"
          aria-pressed={activo}
          onClick={alternar}
          className={cn("py-[4.5px] pl-[10px]", activo ? "pr-1" : "pr-[10px]")}
        >
          {motivo === undefined ? "Perdido" : `Perdido: ${motivoPerdidaLabel(motivo)}`}
        </button>

        {activo ? (
          <button
            type="button"
            aria-label="Elegir motivo de pérdida"
            aria-expanded={abierto}
            onClick={() => (abierto ? cerrar() : setAbierto(true))}
            className="text-ink-faint hover:text-ink-primary py-[4.5px] pr-[9px] pl-0.5"
          >
            <KeyboardArrowDown size={12} className="shrink-0" />
          </button>
        ) : null}
      </div>

      {abierto ? (
        <div className="border-line-control bg-surface-elevated absolute top-[calc(100%+4px)] left-0 z-30 flex w-[200px] flex-col gap-0.5 rounded-[10px] border p-2 shadow-lg">
          <p className="text-ink-fainter px-1.5 pb-1 font-mono text-[9px] font-semibold tracking-[0.13em] uppercase">
            Motivo de pérdida
          </p>

          <button
            type="button"
            aria-pressed={motivo === undefined}
            onClick={() => {
              onElegirMotivo(null);
              cerrar();
            }}
            className={cn(OPCION_BASE, motivo === undefined ? OPCION_ON : OPCION_OFF)}
          >
            Todos los motivos
          </button>

          {motivos.length > 0 ? (
            motivos.map((m) => {
              const elegido = m === motivo;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={elegido}
                  // Volver a elegir el puesto vuelve a "todos", igual que un chip.
                  onClick={() => {
                    onElegirMotivo(elegido ? null : m);
                    cerrar();
                  }}
                  className={cn(OPCION_BASE, elegido ? OPCION_ON : OPCION_OFF)}
                >
                  {motivoPerdidaLabel(m)}
                </button>
              );
            })
          ) : (
            <p className="text-ink-fainter px-1.5 py-1 text-[10.5px]">
              Ninguna sesión perdida registró motivo.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
