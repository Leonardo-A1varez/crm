"use client";

import { Close, KeyboardArrowDown, KeyboardArrowUp, SearchIcon } from "@/components/icons";

/**
 * Barra de búsqueda del hilo. Es puro control: el texto, el conteo y la
 * posición activa los maneja `ChatThread`, que es quien tiene los mensajes.
 *
 * Cerrada ocupa una franja mínima con el botón a la derecha en vez de
 * desaparecer del todo: un buscador que solo existe si ya sabés que existe no
 * lo usa nadie. Abierta empuja el hilo hacia abajo en lugar de flotar encima —
 * flotando taparía la primera burbuja, que es justo donde caen las
 * coincidencias más recientes.
 */
export function BuscadorHilo({
  abierto,
  consulta,
  total,
  posicion,
  onAbrir,
  onCerrar,
  onConsulta,
  onAnterior,
  onSiguiente,
}: {
  abierto: boolean;
  consulta: string;
  total: number;
  /** Ordinal 1..total de la coincidencia enfocada. `0` si no hay ninguna. */
  posicion: number;
  onAbrir: () => void;
  onCerrar: () => void;
  onConsulta: (valor: string) => void;
  onAnterior: () => void;
  onSiguiente: () => void;
}) {
  if (!abierto) {
    return (
      <div className="flex justify-end px-[26px] pt-2">
        <button
          type="button"
          onClick={onAbrir}
          className="text-ink-faint hover:text-ink-body hover:bg-surface-elevated flex items-center gap-1.5 rounded-[8px] px-2 py-[3px] text-[11px] transition-colors"
        >
          <SearchIcon size={13} className="shrink-0" />
          Buscar en la conversación
        </button>
      </div>
    );
  }

  const buscando = consulta.trim().length > 0;

  return (
    <div className="px-[26px] pt-2">
      <div className="bg-surface-elevated border-line-card flex items-center gap-2 rounded-[9px] border px-2.5 py-[6px]">
        <SearchIcon className="text-ink-ghost shrink-0" size={15} />
        <input
          // `type="text"` y no `search`: con `search` el Escape del navegador
          // vacía el campo y nunca llega al handler que cierra la barra.
          type="text"
          value={consulta}
          autoFocus
          onChange={(e) => onConsulta(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (e.shiftKey) onAnterior();
            else onSiguiente();
          }}
          placeholder="Buscar en esta conversación"
          aria-label="Buscar en esta conversación"
          className="text-ink-body placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12px] outline-none"
        />
        <span
          aria-live="polite"
          className={`shrink-0 font-mono text-[10.5px] ${total === 0 && buscando ? "text-warn" : "text-ink-faint"}`}
        >
          {!buscando ? "" : total === 0 ? "Sin coincidencias" : `${posicion}/${total}`}
        </span>
        <button
          type="button"
          onClick={onAnterior}
          disabled={total === 0}
          aria-label="Coincidencia anterior"
          className="text-ink-faint hover:text-ink-body hover:bg-surface-hover shrink-0 rounded-[6px] p-[3px] transition-colors disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <KeyboardArrowUp size={14} />
        </button>
        <button
          type="button"
          onClick={onSiguiente}
          disabled={total === 0}
          aria-label="Coincidencia siguiente"
          className="text-ink-faint hover:text-ink-body hover:bg-surface-hover shrink-0 rounded-[6px] p-[3px] transition-colors disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <KeyboardArrowDown size={14} />
        </button>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar la búsqueda"
          className="text-ink-faint hover:text-ink-body hover:bg-surface-hover shrink-0 rounded-[6px] p-[3px] transition-colors"
        >
          <Close size={14} />
        </button>
      </div>
    </div>
  );
}
