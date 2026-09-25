import { Eyebrow } from "@/components/shared/Eyebrow";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Tarjeta de una sección de ajustes. Mismo esqueleto que `Seccion` de métricas
 * —encabezado con eyebrow, cuerpo, nota al pie— para que las dos pantallas se
 * lean como una sola aplicación.
 */
export function SeccionAjuste({
  titulo,
  extra,
  nota,
  acciones,
  className,
  children,
}: {
  titulo: string;
  extra?: string;
  /** Qué mirar, o qué NO configura esta sección. Va al pie, en gris. */
  nota?: string;
  acciones?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("border-line-card bg-surface-card rounded-[14px] border p-5", className)}
    >
      <div className="flex items-center gap-2.5 pb-4">
        <Eyebrow>{titulo}</Eyebrow>
        {extra ? <span className="text-ink-ghost font-mono text-[10px]">{extra}</span> : null}
        {acciones ? <div className="ml-auto flex items-center gap-1.5">{acciones}</div> : null}
      </div>
      {children}
      {nota ? <p className="text-ink-ghost pt-3.5 text-[10.5px] leading-relaxed">{nota}</p> : null}
    </section>
  );
}
