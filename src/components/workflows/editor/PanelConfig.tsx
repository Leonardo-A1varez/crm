"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { categoriaChipFondo, categoriaColor, categoriaDescripcion } from "./contrato-nodos";
import type { CategoriaVisual, IconoNodo } from "./contrato-nodos";
import { FOCO, MEDIDAS, PRESION_TACTIL, TRANSICION_CONTROL } from "./tokens-editor";
import { GloboProblema } from "./Validacion";
import type { ProblemaNodo } from "./severidad";

export interface PanelConfigProps {
  /** `null` = no hay nada seleccionado. El panel muestra los ajustes del flujo. */
  nodo: {
    id: string;
    /** Tipo técnico. Va en mono junto al id: son datos que se comparan contra un log. */
    tipo: string;
    nombre: string;
    categoria: CategoriaVisual;
    icono?: IconoNodo;
  } | null;
  problemas?: readonly ProblemaNodo[];
  /** El formulario del tipo de nodo. Lo arma quien conoce ese tipo, no este panel. */
  children?: ReactNode;
  /**
   * Los ajustes del flujo entero —hoy, el tope de pasos por corrida—, que se
   * muestran cuando no hay ningún bloque seleccionado: sin selección, el panel
   * habla del flujo. Los arma quien conoce el flujo, igual que el formulario de
   * un bloque lo arma quien conoce ese tipo.
   */
  ajustesFlujo?: ReactNode;
  onEliminar?: () => void;
  /** "Ejecutar hasta acá": corre el flujo con datos reales hasta este nodo y para. */
  onProbarHastaAca?: () => void;
  /**
   * Ancho en px. Por defecto `MEDIDAS.PANEL_CONFIG`; la condición pide
   * `MEDIDAS.PANEL_CONDICION`, porque sus tres selectores más el anidado no
   * entran en 320. Lo decide quien sabe qué bloque está abierto, no el panel.
   */
  ancho?: number;
  className?: string;
}

/**
 * El panel de configuración del nodo seleccionado.
 *
 * Es un armazón: encabezado, cuerpo con scroll y pie con las dos acciones del
 * nodo. El formulario lo pone quien conoce ese tipo de nodo. Con 57 tipos, un
 * panel que supiera dibujar los 57 formularios sería el archivo que hay que
 * tocar cada vez que se agrega uno.
 *
 * ## Los problemas se muestran acá **además** de sobre el nodo
 *
 * Puede parecer que contradice la regla de "nunca en un panel aparte", pero es
 * lo contrario: este panel es el nodo. Se abrió porque se clickeó ese nodo, y
 * el problema aparece arriba de su propio formulario, junto al campo que falta.
 * Lo que la regla prohíbe es una lista general de problemas de todo el flujo,
 * donde hay que buscar cuál es cuál.
 *
 * ## `id` y `tipo` en Geist Mono, y por qué se muestran
 *
 * `msg_texto · n2` no le dice nada a un vendedor, y está bien: no es para él.
 * Es lo que hace que un reporte de soporte diga "falla el n2" en lugar de "el
 * segundo cuadradito azul". Por eso va en mono y apagado — es dato de
 * comparación, no información de la tarea.
 */
export function PanelConfig({
  nodo,
  problemas,
  children,
  ajustesFlujo,
  onEliminar,
  onProbarHastaAca,
  ancho = MEDIDAS.PANEL_CONFIG,
  className,
}: PanelConfigProps) {
  if (!nodo) {
    return (
      <aside
        style={{ width: ancho }}
        aria-label={ajustesFlujo ? "Ajustes del flujo" : "Configuración del bloque"}
        className={cn(
          "border-line-layout bg-surface-panel flex shrink-0 flex-col border-l",
          className,
        )}
      >
        {ajustesFlujo ? (
          <>
            {/*
              Mismo encabezado que el de un bloque —título y una línea chica
              debajo—, para que pasar de un bloque a ningún bloque no mueva el
              borde de abajo del encabezado.
            */}
            <div className="border-line-layout flex shrink-0 flex-col gap-1 border-b px-4 py-3.5">
              <h2 className="text-ink-primary text-[13px] leading-none font-semibold">
                Ajustes del flujo
              </h2>
              <span className="text-ink-ghost text-[10.5px]">Valen para todo el flujo.</span>
            </div>
            <div className="border-line-layout shrink-0 border-b p-4">{ajustesFlujo}</div>
          </>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8">
          <p className="text-ink-ghost text-center text-[12px] leading-relaxed text-balance">
            Elegí un bloque del lienzo para configurarlo.
          </p>
          <p className="text-ink-ghost/70 text-center text-[10.5px] leading-relaxed text-balance">
            También podés arrastrar uno nuevo desde la izquierda, o soltarlo sobre una línea para
            insertarlo entre dos pasos.
          </p>
        </div>
      </aside>
    );
  }

  const { icono: Icono } = nodo;

  return (
    <aside
      style={{ width: ancho }}
      aria-label={`Configuración de ${nodo.nombre}`}
      className={cn(
        "border-line-layout bg-surface-panel flex shrink-0 flex-col border-l",
        className,
      )}
    >
      <div className="border-line-layout flex shrink-0 items-center gap-2.5 border-b px-4 py-3.5">
        <span
          aria-hidden
          title={categoriaDescripcion(nodo.categoria)}
          style={{
            background: categoriaChipFondo(nodo.categoria),
            color: categoriaColor(nodo.categoria),
          }}
          className="grid size-5 shrink-0 place-items-center rounded-md"
        >
          {Icono ? <Icono className="size-3.5" /> : null}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-ink-primary truncate text-[13px] leading-none font-semibold">
            {nodo.nombre}
          </h2>
          <span className="text-ink-ghost truncate font-mono text-[10.5px]">
            {nodo.tipo} · {nodo.id}
          </span>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          {problemas?.map((p) => (
            <GloboProblema key={`${p.severidad}-${p.mensaje}`} problema={p} className="w-full" />
          ))}
          {children}
        </div>
      </ScrollArea>

      {onEliminar || onProbarHastaAca ? (
        <div className="border-line-layout flex shrink-0 gap-2 border-t px-4 py-3">
          {onEliminar ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onEliminar}
              className={cn("text-danger flex-1", TRANSICION_CONTROL, PRESION_TACTIL, FOCO)}
            >
              Eliminar bloque
            </Button>
          ) : null}
          {onProbarHastaAca ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onProbarHastaAca}
              title="Corre el flujo con datos reales y frena justo antes de este bloque"
              className={cn("flex-1", TRANSICION_CONTROL, PRESION_TACTIL, FOCO)}
            >
              Ejecutar hasta acá
            </Button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
