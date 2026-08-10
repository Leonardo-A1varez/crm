import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Tarjeta de la consola con la tipografía que el handoff pide para §4:
 * "Título de tarjeta 13px / 650 / -.015em" y subtítulo secundario de 10.5px.
 *
 * Existe porque el resto de la app usa `Eyebrow` (mono 9px uppercase) como
 * título de sección, y en §4 el eyebrow no es el título: el título es texto
 * normal de 13px y el eyebrow queda para las etiquetas internas.
 */
export function TarjetaConsola({
  titulo,
  subtitulo,
  icono,
  acciones,
  className,
  children,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  icono?: ReactNode;
  acciones?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("bg-surface-card border-line-card rounded-[15px] border p-[17px]", className)}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-ink-primary flex items-center gap-1.5 text-[13px] font-[650] tracking-[-0.015em]">
            {icono}
            {titulo}
          </h2>
          {subtitulo !== undefined ? (
            <p className="text-ink-faint mt-1 text-[10.5px]">{subtitulo}</p>
          ) : null}
        </div>
        {acciones ? <div className="flex shrink-0 items-center gap-2">{acciones}</div> : null}
      </div>
      {children}
    </section>
  );
}
