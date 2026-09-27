"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowForward } from "@/components/icons";
import { FOCO, MEDIDAS, PRESION_TACTIL, TRANSICION_CONTROL } from "./tokens-editor";

/**
 * La barra superior de las cuatro pantallas del editor.
 *
 * Es un armazón, no cuatro barras parecidas: volver, el nombre del flujo, una
 * zona de contexto a la izquierda y las acciones a la derecha. Cada pantalla
 * compone lo suyo. Que sea el mismo componente es lo que garantiza que el
 * botón de volver esté siempre en el mismo píxel al pasar de editar a ver el
 * diff y de ahí a la corrida — moverlo 4 px entre pantallas es de las cosas
 * que nadie nombra y todos sienten.
 *
 * Tiene que entrar entera en el ancho que deja la barra lateral a 1280 px
 * (~1058 px). Las acciones nunca se encogen; lo que cede, en este orden, es el
 * nombre del flujo (se trunca, con el nombre completo en `title`) y los textos
 * largos del contexto, que tienen una versión corta por debajo de `@6xl/barra`
 * (72rem de barra). La consulta es al ancho de la barra y no al del viewport:
 * la barra lateral y los paneles hacen que el viewport no diga cuánto lugar hay.
 */
export function BarraEditor({
  titulo,
  onVolver,
  volverEtiqueta = "Flujos",
  contexto,
  acciones,
  className,
}: {
  titulo: string;
  onVolver?: () => void;
  volverEtiqueta?: string;
  /** Versión, estado del borrador, hora de guardado. Lo que describe qué estás mirando. */
  contexto?: ReactNode;
  /** Probar, Guardar, Publicar. Lo que cambia el mundo. */
  acciones?: ReactNode;
  className?: string;
}) {
  return (
    <header
      style={{ height: MEDIDAS.BARRA }}
      className={cn(
        "border-line-layout bg-surface-panel @container/barra flex shrink-0 items-center gap-3 border-b pr-4 pl-3.5",
        className,
      )}
    >
      {onVolver ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onVolver}
          className={cn("shrink-0 gap-1.5", TRANSICION_CONTROL, PRESION_TACTIL)}
        >
          <ArrowForward aria-hidden className="size-3.5 rotate-180" />
          {volverEtiqueta}
        </Button>
      ) : null}

      <h1
        title={titulo}
        className="text-ink-primary min-w-[6rem] truncate text-[14px] leading-tight font-semibold tracking-tight"
      >
        {titulo}
      </h1>

      {contexto}

      <div className="ml-auto flex shrink-0 items-center gap-2">{acciones}</div>
    </header>
  );
}

/**
 * El selector de versión de la barra. Mono porque `v3` es un dato que se
 * compara —"¿estoy mirando la 3 o la 4?"— y no una palabra que se lee.
 */
export function ChipVersion({
  version,
  estado,
  onClick,
}: {
  version: number;
  estado: "publicada" | "borrador" | "archivada";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Versión ${version}, ${estado}. Cambiar de versión.`}
      className={cn(
        "border-line-control bg-surface-input text-ink-secondary hover:bg-surface-hover inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-md border px-2 font-mono text-[11.5px] tabular-nums",
        TRANSICION_CONTROL,
        PRESION_TACTIL,
        FOCO,
      )}
    >
      v{version} {estado}
      <span aria-hidden className="text-ink-ghost">
        ▾
      </span>
    </button>
  );
}

/**
 * Chip de estado del borrador: "borrador con 3 cambios".
 *
 * `tono` no es decorativo. `info` (azul) para "hay cambios sin publicar" —
 * es información, no un problema. `ok` (verde) para propiedades tranquilizadoras
 * del flujo, del tipo "no intercepta al agente". El punto de color va siempre
 * acompañado del texto: el color solo no comunica nada a quien no lo distingue.
 */
export function ChipEstado({
  children,
  tono = "info",
}: {
  children: ReactNode;
  tono?: "info" | "ok" | "aviso";
}) {
  const clases = {
    info: "bg-info/10 text-info",
    ok: "bg-ok/10 text-ok",
    aviso: "bg-caution/10 text-caution",
  }[tono];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
        clases,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tono === "info" ? "bg-info" : tono === "ok" ? "bg-ok" : "bg-caution",
        )}
      />
      {children}
    </span>
  );
}
