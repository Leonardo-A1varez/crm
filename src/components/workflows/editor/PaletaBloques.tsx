"use client";

import { memo, useMemo, useState, type DragEvent } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchIcon, KeyboardArrowDown } from "@/components/icons";
import { CURVA, DURACION, FOCO, MEDIDAS, TRANSICION_CONTROL } from "./tokens-editor";
import type { IconoNodo } from "./contrato-nodos";

/**
 * Lo mínimo que la paleta necesita saber de un bloque. Se declara acá y no se
 * importa de `nodos-catalogo` para que la paleta pueda mostrar cosas que el
 * catálogo todavía no tiene —bloques de un plugin, por ejemplo— sin tocar este
 * archivo.
 */
export interface BloqueDisponible {
  tipo: string;
  nombre: string;
  descripcion: string;
  icono: IconoNodo;
  /**
   * Por qué este bloque no aplica al flujo actual. `undefined` = aplica.
   *
   * Es una frase completa en el idioma del vendedor, no un código:
   * "Necesita una conversación abierta, y este flujo arranca sin lead."
   * El motivo se muestra; sin motivo no se atenúa. Atenuar sin explicar
   * convierte media paleta en un misterio.
   */
  motivoNoAplica?: string;
}

export interface CategoriaBloques {
  id: string;
  nombre: string;
  /** Hex de la categoría, como lo entrega `nodos-catalogo`. Va inline: no hay clase para un hex arbitrario. */
  color: string;
  bloques: readonly BloqueDisponible[];
}

export interface PaletaBloquesProps {
  categorias: readonly CategoriaBloques[];
  /**
   * Nombre del disparador del flujo, para el pie: "no aplican a Lead creado".
   * El pie explica el atenuado una vez, y así ningún bloque gris queda mudo
   * para quien no pasa el mouse por encima.
   */
  disparadorActual?: string;
  onArrastrar?: (tipo: string) => void;
  /** Alternativa al arrastre: doble clic o Enter agrega el bloque al final. */
  onAgregar?: (tipo: string) => void;
  className?: string;
}

function coincide(b: BloqueDisponible, q: string): boolean {
  if (!q) return true;
  const t = q.toLowerCase();
  return b.nombre.toLowerCase().includes(t) || b.descripcion.toLowerCase().includes(t);
}

/**
 * Un bloque de la paleta.
 *
 * Memoizado porque con 57 bloques y un buscador que filtra en cada tecla, sin
 * memo cada pulsación repinta las 57 filas. El `onArrastrar`/`onAgregar` que
 * recibe tiene que ser estable en el padre o el memo no sirve de nada.
 *
 * ## El atenuado
 *
 * Un bloque que no aplica se ve al 45 % y **sigue estando en la lista**. No se
 * esconde por defecto: esconderlo enseña que el bloque no existe, atenuarlo
 * enseña que existe y por qué hoy no sirve. La segunda lección es la que
 * evita que alguien lo busque tres veces.
 *
 * Sigue siendo alcanzable con el tabulador y su nombre accesible incluye el
 * motivo, así que quien navega con lector de pantalla recibe la misma
 * información que quien pasa el mouse. Lo que no hace es arrastrarse.
 */
const ItemPaleta = memo(function ItemPaleta({
  bloque,
  onArrastrar,
  onAgregar,
}: {
  bloque: BloqueDisponible;
  onArrastrar?: (tipo: string) => void;
  onAgregar?: (tipo: string) => void;
}) {
  const { icono: Icono, motivoNoAplica } = bloque;
  const aplica = !motivoNoAplica;

  function alArrastrar(e: DragEvent<HTMLDivElement>) {
    if (!aplica) {
      e.preventDefault();
      return;
    }
    // Mismo canal que usa el canvas ya existente del proyecto: un bloque
    // arrastrado desde esta paleta se puede soltar en cualquiera de los dos.
    e.dataTransfer.setData("application/reactflow", bloque.tipo);
    e.dataTransfer.effectAllowed = "move";
    onArrastrar?.(bloque.tipo);
  }

  return (
    <div
      draggable={aplica}
      onDragStart={alArrastrar}
      onDoubleClick={aplica ? () => onAgregar?.(bloque.tipo) : undefined}
      onKeyDown={
        aplica
          ? (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAgregar?.(bloque.tipo);
              }
            }
          : undefined
      }
      tabIndex={0}
      role="option"
      aria-selected={false}
      aria-disabled={!aplica || undefined}
      title={motivoNoAplica ?? bloque.descripcion}
      aria-label={
        aplica
          ? `${bloque.nombre}. ${bloque.descripcion}`
          : `${bloque.nombre}. No aplica: ${motivoNoAplica}`
      }
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left",
        TRANSICION_CONTROL,
        FOCO,
        aplica
          ? "hover:bg-surface-hover cursor-grab active:cursor-grabbing"
          : "cursor-not-allowed opacity-45",
      )}
    >
      <Icono aria-hidden className="text-ink-dim size-3.5 shrink-0" />
      <span className="text-ink-body flex-1 truncate text-[11.5px] leading-none font-medium">
        {bloque.nombre}
      </span>
      {!aplica ? (
        <span className="text-ink-ghost shrink-0 font-mono text-[9px] tracking-wide uppercase">
          no aplica
        </span>
      ) : null}
    </div>
  );
});

/**
 * Paleta de bloques del editor.
 *
 * Categorías plegables con buscador arriba. Cuando hay búsqueda desaparecen
 * las categorías y queda una lista plana: buscando "etiqueta" nadie quiere
 * adivinar en cuál de las siete cajas cayó el resultado.
 */
export function PaletaBloques({
  categorias,
  disparadorActual,
  onArrastrar,
  onAgregar,
  className,
}: PaletaBloquesProps) {
  const [busqueda, setBusqueda] = useState("");
  const [ocultarNoAplican, setOcultarNoAplican] = useState(false);
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(
    () => new Set(categorias[0] ? [categorias[0].id] : []),
  );

  const visibles = useMemo(
    () =>
      categorias
        .map((c) => ({
          ...c,
          bloques: c.bloques.filter(
            (b) => coincide(b, busqueda) && !(ocultarNoAplican && b.motivoNoAplica),
          ),
        }))
        .filter((c) => c.bloques.length > 0),
    [categorias, busqueda, ocultarNoAplican],
  );

  const totalNoAplican = useMemo(
    () => categorias.reduce((n, c) => n + c.bloques.filter((b) => b.motivoNoAplica).length, 0),
    [categorias],
  );

  const buscando = busqueda.trim().length > 0;
  const planos = buscando ? visibles.flatMap((c) => c.bloques) : [];

  return (
    <aside
      style={{ width: MEDIDAS.PALETA }}
      aria-label="Bloques disponibles"
      className={cn(
        "border-line-layout bg-surface-panel flex shrink-0 flex-col border-r",
        className,
      )}
    >
      <div className="border-line-layout flex shrink-0 flex-col gap-2 border-b p-3">
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="text-ink-ghost pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <Input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar bloque…"
            aria-label="Buscar un bloque por nombre o descripción"
            className="h-8 pl-8 text-[12px]"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div role="listbox" aria-label="Bloques" className="flex flex-col gap-0.5 p-2 pb-4">
          {buscando ? (
            planos.length > 0 ? (
              planos.map((b) => (
                <ItemPaleta
                  key={b.tipo}
                  bloque={b}
                  onArrastrar={onArrastrar}
                  onAgregar={onAgregar}
                />
              ))
            ) : (
              <p className="text-ink-ghost px-2 py-6 text-center text-[11.5px] text-balance">
                Ningún bloque se llama ni hace algo parecido a{" "}
                <span className="font-mono">{busqueda}</span>.
              </p>
            )
          ) : (
            visibles.map((c) => {
              const abierta = abiertas.has(c.id);
              return (
                <div key={c.id} className="flex flex-col">
                  <button
                    type="button"
                    aria-expanded={abierta}
                    onClick={() =>
                      setAbiertas((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                    className={cn(
                      "hover:bg-surface-hover flex h-8 items-center gap-2 rounded-md px-2",
                      TRANSICION_CONTROL,
                      FOCO,
                    )}
                  >
                    <KeyboardArrowDown
                      aria-hidden
                      className={cn(
                        "text-ink-ghost size-3 shrink-0 transition-transform",
                        DURACION.PANEL,
                        CURVA.SALIDA,
                        !abierta && "-rotate-90",
                        "motion-reduce:transition-none",
                      )}
                    />
                    <span
                      aria-hidden
                      style={{ backgroundColor: c.color }}
                      className="size-3 shrink-0 rounded-[4px]"
                    />
                    <span className="text-ink-primary flex-1 text-left text-[11.5px] leading-none font-semibold">
                      {c.nombre}
                    </span>
                    <span className="text-ink-ghost font-mono text-[10px] tabular-nums">
                      {c.bloques.length}
                    </span>
                  </button>

                  {/* Plegado por `grid-template-rows`, el patrón que ya usa el
                      proyecto: anima sin medir alturas en JS y sin saltos. */}
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows]",
                      DURACION.PANEL,
                      CURVA.SALIDA,
                      abierta ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                      "motion-reduce:transition-none",
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="flex flex-col gap-0.5 py-1 pl-4">
                        {c.bloques.map((b) => (
                          <ItemPaleta
                            key={b.tipo}
                            bloque={b}
                            onArrastrar={onArrastrar}
                            onAgregar={onAgregar}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {totalNoAplican > 0 ? (
        <div className="border-line-layout bg-surface-root flex shrink-0 flex-col gap-2 border-t p-3">
          <p className="text-ink-ghost text-[10.5px] leading-relaxed text-pretty">
            Los atenuados no se pueden usar en este flujo: unos todavía no se ejecutan
            {disparadorActual ? (
              <>
                {" "}
                y otros no aplican a{" "}
                <span className="text-ink-faint font-mono">{disparadorActual}</span>
              </>
            ) : null}
            . El motivo está en el globo al pasar el mouse.
          </p>
          <label className="text-ink-faint flex cursor-pointer items-center gap-2 text-[10.5px]">
            <input
              type="checkbox"
              checked={ocultarNoAplican}
              onChange={(e) => setOcultarNoAplican(e.target.checked)}
              className="accent-brand size-3.5"
            />
            Ocultar los {totalNoAplican} que no aplican
          </label>
        </div>
      ) : null}
    </aside>
  );
}

/**
 * La paleta que se abre al soltar un cable en el vacío.
 *
 * **El gesto:** arrastrás un cable desde el puerto de salida de un nodo y lo
 * soltás donde no hay nada. Casi todas las herramientas descartan el gesto y no
 * pasa nada. Acá se abre esta lista, filtrada por lo que puede seguir a ese
 * puerto, en el punto exacto donde se soltó, y elegir un bloque lo crea ahí y
 * lo conecta.
 *
 * La persona ya dijo dos cosas al arrastrar: **de dónde sale** y **dónde lo
 * quiere**. Descartar el gesto tira las dos y la obliga a ir a la paleta,
 * buscar el bloque, arrastrarlo al lugar y volver a tirar el cable.
 *
 * Se cierra con Escape y devuelve el foco: es un menú flotante, y quedarse
 * abierto encima del lienzo sin salida de teclado sería una trampa.
 */
export function PaletaFlotante({
  categorias,
  posicion,
  titulo,
  onElegir,
  onCerrar,
}: {
  categorias: readonly CategoriaBloques[];
  /** En píxeles de pantalla: es donde se soltó el cable. */
  posicion: { x: number; y: number };
  /** "Después de la salida Sí de ¿Consulta de producto?" */
  titulo?: string;
  onElegir: (tipo: string) => void;
  onCerrar: () => void;
}) {
  const bloques = categorias.flatMap((c) => c.bloques).filter((b) => !b.motivoNoAplica);

  return (
    <div
      role="dialog"
      aria-label="Elegir el bloque que sigue"
      style={{ left: posicion.x, top: posicion.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCerrar();
        }
      }}
      className={cn(
        "border-line-card bg-surface-elevated fixed z-50 flex w-60 flex-col rounded-lg border shadow-xl",
        "animate-in fade-in zoom-in-95",
        DURACION.FLOTANTE,
        CURVA.SALIDA,
        // El menú crece desde donde se soltó el cable, no desde su centro.
        // Es la diferencia entre "apareció donde solté" y "apareció y ya".
        "origin-top-left motion-reduce:animate-none",
      )}
    >
      {titulo ? (
        <p className="border-line-layout text-ink-faint border-b px-3 py-2 text-[10.5px] leading-snug text-pretty">
          {titulo}
        </p>
      ) : null}
      <div
        role="listbox"
        aria-label="Bloques"
        className="flex max-h-64 flex-col gap-0.5 overflow-auto p-1.5"
      >
        {bloques.map((b) => (
          <ItemPaleta key={b.tipo} bloque={b} onAgregar={onElegir} />
        ))}
      </div>
      <button
        type="button"
        onClick={onCerrar}
        className={cn(
          "border-line-layout text-ink-ghost hover:text-ink-body border-t px-3 py-2 text-[10.5px]",
          TRANSICION_CONTROL,
          FOCO,
        )}
      >
        Cancelar (Esc)
      </button>
    </div>
  );
}
