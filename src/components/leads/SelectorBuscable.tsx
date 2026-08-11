"use client";

import { useCallback, useRef, useState } from "react";
import { KeyboardArrowDown, SearchIcon } from "@/components/icons";
import { CHIP_BASE, CHIP_OFF, CHIP_ON } from "@/components/leads/ChipFiltro";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
import { filtrarOpciones } from "@/lib/ui/selector-buscable";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface OpcionBuscable {
  /** Identifica la opción. Es lo que vuelve por `onElegir`. */
  valor: string;
  /** Lo que se lee y contra lo que busca el input. */
  texto: string;
  /** Punto de color a la izquierda, cuando la dimensión tiene uno. */
  adorno?: ReactNode;
}

/**
 * Mini-pantalla de filtro: un chip que abre un panel flotante con buscador y la
 * lista de opciones.
 *
 * Existe una sola vez para las tres dimensiones de lista variable —cierre,
 * etiquetas y vehículos—. Las tres crecen y se reducen con los datos, así que
 * dibujarlas como chips inline dejaba la barra de filtros tapando la lista que
 * filtra. Y el `<select>` nativo que hacía este trabajo para el vehículo no
 * servía de reemplazo: el popup lo pinta el sistema operativo, no respeta el
 * diseño del panel y no admite ni buscador ni adornos.
 *
 * Mismo lenguaje que los popovers del Twin: panel flotante sobre el contenido,
 * `useCerrarAlSalir` en el contenedor y ningún botón "Cerrar" propio — se sale
 * con Escape, clickeando afuera o eligiendo algo.
 *
 * El contenedor es `relative` y el panel `absolute`: la barra no puede crecer
 * al abrirlo, o abrir el filtro empujaría hacia abajo la lista que se filtra.
 */
export function SelectorBuscable({
  etiqueta,
  vacio,
  placeholder,
  opciones,
  valor,
  textoActivo,
  sinOpciones,
  onElegir,
}: {
  /** Nombre de la dimensión. Rotula el control para lectores de pantalla. */
  etiqueta: string;
  /** Texto del chip cuando no hay nada elegido. */
  vacio: string;
  placeholder: string;
  opciones: readonly OpcionBuscable[];
  /** `valor` de la opción elegida, si alguna lo está. */
  valor: string | undefined;
  /**
   * Qué decir en el chip cuando hay filtro puesto. Por defecto lo dice la
   * opción elegida; se pasa a mano cuando el filtro puede venir de un link que
   * no coincide con ninguna opción de la lista actual.
   */
  textoActivo?: string;
  /** Qué decir cuando la lista viene vacía porque los datos no tienen nada. */
  sinOpciones: string;
  onElegir: (valor: string | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  const cerrar = useCallback(() => {
    setQ("");
    setAbierto(false);
  }, []);

  // El `ref` abarca el chip y el panel: clickear el chip para cerrar no puede
  // contar como "click afuera", o cerraría dos veces y volvería a abrir.
  useCerrarAlSalir(abierto, panel, cerrar);

  const elegida = opciones.find((o) => o.valor === valor);
  const texto = textoActivo ?? elegida?.texto;
  const candidatas = filtrarOpciones(opciones, q);

  const elegir = (siguiente: string | null) => {
    onElegir(siguiente);
    cerrar();
  };

  return (
    <div ref={panel} className="relative">
      <button
        type="button"
        aria-label={etiqueta}
        aria-expanded={abierto}
        onClick={() => (abierto ? cerrar() : setAbierto(true))}
        className={cn(CHIP_BASE, texto !== undefined ? CHIP_ON : CHIP_OFF)}
      >
        {elegida?.adorno}
        <span className="max-w-[168px] truncate">{texto ?? vacio}</span>
        <KeyboardArrowDown size={12} className="text-ink-faint -mr-[3px] shrink-0" />
      </button>

      {abierto ? (
        <div className="border-line-control bg-surface-elevated absolute top-[calc(100%+4px)] left-0 z-30 flex w-[232px] flex-col gap-1.5 rounded-[10px] border p-2 shadow-lg">
          <div className="relative">
            <SearchIcon
              size={12}
              aria-hidden
              className="text-ink-faint pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
            />
            <input
              value={q}
              autoFocus
              maxLength={60}
              aria-label={`Buscar en ${etiqueta}`}
              placeholder={placeholder}
              onChange={(e) => setQ(e.target.value)}
              className="text-ink-body border-line-input bg-surface-input w-full rounded-[7px] border py-1 pr-2 pl-[26px] text-[11.5px] outline-none"
            />
          </div>

          {texto !== undefined ? (
            <button
              type="button"
              onClick={() => elegir(null)}
              className="text-ink-dim hover:bg-surface-card rounded-[6px] px-1.5 py-1 text-left text-[11.5px] transition-colors"
            >
              Sin filtro
            </button>
          ) : null}

          {candidatas.length > 0 ? (
            <ul className="flex max-h-[168px] flex-col overflow-y-auto">
              {candidatas.map((o) => {
                const activa = o.valor === valor;
                return (
                  <li key={o.valor}>
                    <button
                      type="button"
                      aria-pressed={activa}
                      // Volver a elegir la puesta la apaga, igual que un chip.
                      onClick={() => elegir(activa ? null : o.valor)}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-left text-[11.5px] transition-colors",
                        activa
                          ? "bg-surface-avatar text-ink-primary font-[550]"
                          : "text-ink-secondary hover:bg-surface-card",
                      )}
                    >
                      {o.adorno}
                      <span className="min-w-0 truncate">{o.texto}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-ink-fainter px-1.5 py-1 text-[10.5px]">
              {opciones.length === 0 ? sinOpciones : "Nada coincide con lo escrito."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
