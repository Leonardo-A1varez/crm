"use client";

import { useId, useState } from "react";
import { FilterList } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { FormEvent, ReactNode } from "react";

/**
 * El botón de filtro de un encabezado de columna y el desplegable que abre.
 *
 * Es un popover de Base UI (el que agrega shadcn), no un panel hecho a mano:
 * resuelve solo lo que en la tabla es fácil de romper — sale por un portal, así
 * que el `overflow` de la tabla no lo corta; devuelve el foco al botón al
 * cerrarse; cierra con Escape; y se reposiciona contra el borde de la ventana.
 *
 * El contenido solo existe mientras está abierto, así que cada apertura arranca
 * con un borrador nuevo copiado de la URL: cerrar sin aplicar descarta lo que se
 * tocó, que es lo que se espera de un botón "Aplicar".
 *
 * Con filtro puesto, el botón se tiñe y suma un punto. El punto no es lo único
 * que lo dice: el nombre accesible cambia a "… (filtro activo)".
 */
export function FiltroColumna({
  etiqueta,
  activo,
  ancho = 288,
  children,
}: {
  /** Nombre de la columna, para el lector de pantalla: "Categoría". */
  etiqueta: string;
  activo: boolean;
  /** Ancho del desplegable en px. */
  ancho?: number;
  children: (cerrar: () => void) => ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger
        aria-label={`Filtrar ${etiqueta}${activo ? " (filtro activo)" : ""}`}
        className={cn(
          "focus-visible:ring-brand/60 relative inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] transition-colors outline-none before:absolute before:-inset-1 before:content-[''] focus-visible:ring-2",
          activo || abierto
            ? "bg-surface-avatar text-ink-primary"
            : "text-ink-ghost hover:bg-surface-hover hover:text-ink-secondary",
        )}
      >
        <FilterList size={14} aria-hidden />
        {activo ? (
          <span
            aria-hidden
            className="bg-brand ring-surface-panel absolute top-[3px] right-[3px] size-[7px] rounded-full ring-2"
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        aria-label={`Filtro de ${etiqueta}`}
        style={{ width: ancho }}
        className="border-line-control bg-surface-elevated max-h-[min(600px,calc(var(--available-height)-8px))] gap-0 rounded-[10px] border p-0 shadow-lg ring-0 motion-reduce:animate-none"
      >
        {children(() => setAbierto(false))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Cuerpo común de todos los desplegables: título, el contenido del filtro y el
 * pie con "Limpiar filtro" y "Aplicar". Es un `<form>`, así que Enter en
 * cualquier campo aplica.
 *
 * "Aplicar" queda con `aria-disabled` y no `disabled`: un botón deshabilitado
 * sale del orden de tabulación y el lector de pantalla no llega a oír por qué.
 * Así sigue enfocable y el motivo (`aviso`) está asociado con `aria-describedby`.
 */
export function PanelFiltro({
  titulo,
  hayFiltro,
  aviso,
  avisoEnCampo,
  onAplicar,
  onLimpiar,
  children,
}: {
  titulo: string;
  hayFiltro: boolean;
  /** Por qué no se puede aplicar lo que hay en pantalla; `null` si se puede. */
  aviso: string | null;
  /**
   * `id` del elemento del cuerpo que ya muestra el `aviso` (el error de un
   * campo). Si viene, el pie no lo repite y "Aplicar" apunta a ese elemento.
   */
  avisoEnCampo?: string;
  onAplicar: () => void;
  onLimpiar: () => void;
  children: ReactNode;
}) {
  const idAviso = useId();

  function alEnviar(e: FormEvent) {
    e.preventDefault();
    if (aviso === null) onAplicar();
  }

  return (
    <form onSubmit={alEnviar} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-3 pb-2.5">
        <h2 className="text-ink-primary text-[12.5px] font-[650] tracking-[-0.01em]">{titulo}</h2>
        {children}
      </div>
      <div className="border-line-layout flex shrink-0 flex-col gap-1.5 border-t px-3 py-2.5">
        {avisoEnCampo === undefined ? (
          <p
            id={idAviso}
            role="status"
            className={cn("text-warn text-[11px] leading-snug", aviso === null && "sr-only")}
          >
            {aviso}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={!hayFiltro}
            onClick={onLimpiar}
            className="text-ink-dim hover:text-ink-primary focus-visible:ring-brand/60 -ml-1 rounded-[6px] px-1 py-1 text-[11.5px] font-[550] underline-offset-2 outline-none hover:underline focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40"
          >
            Limpiar filtro
          </button>
          <button
            type="submit"
            aria-disabled={aviso !== null}
            aria-describedby={aviso !== null ? (avisoEnCampo ?? idAviso) : undefined}
            className="bg-brand text-brand-ink focus-visible:ring-brand/60 focus-visible:ring-offset-surface-elevated rounded-[7px] px-3 py-1.5 text-[11.5px] font-semibold transition-[opacity,transform] outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.97] aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:active:scale-100"
          >
            Aplicar
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Elegir una opción entre pocas, en una fila. Son radios nativos —flechas,
 * grupo y lector de pantalla funcionan solos— con la etiqueta como botón.
 */
export function Segmentado<T extends string>({
  leyenda,
  opciones,
  valor,
  onCambiar,
}: {
  /** Qué se está eligiendo; lo lee el lector de pantalla. */
  leyenda: string;
  opciones: readonly { valor: T; texto: string }[];
  valor: T;
  onCambiar: (valor: T) => void;
}) {
  const nombre = useId();
  return (
    <fieldset className="border-line-control flex min-w-0 gap-0.5 rounded-[9px] border p-0.5">
      <legend className="sr-only">{leyenda}</legend>
      {opciones.map((o) => (
        <label
          key={o.valor}
          className="text-ink-dim hover:text-ink-secondary has-checked:bg-surface-avatar has-checked:text-ink-primary has-focus-visible:ring-brand/60 flex-1 cursor-pointer rounded-[7px] px-2 py-1 text-center text-[11.5px] font-[550] whitespace-nowrap transition-colors has-focus-visible:ring-2"
        >
          <input
            type="radio"
            name={nombre}
            value={o.valor}
            checked={valor === o.valor}
            onChange={() => onCambiar(o.valor)}
            className="sr-only"
          />
          {o.texto}
        </label>
      ))}
    </fieldset>
  );
}
