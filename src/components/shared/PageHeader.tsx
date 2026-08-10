import { MonoMeta } from "@/components/shared/MonoMeta";
import type { ReactNode } from "react";

/**
 * Encabezado de pantalla. Misma tipografía y alturas que el del panel de lista
 * de la bandeja, para que las 7 pantallas del panel arranquen igual: el título
 * a la izquierda con su contador en mono, y las acciones a la derecha.
 */
export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    // Alto fijo y no padding: con padding, las pantallas que traen botones en
    // las acciones quedan 6px más altas que las que no, y el borde inferior no
    // coincide al cambiar de pantalla.
    <header className="border-line-layout bg-surface-panel flex h-[54px] shrink-0 items-center justify-between gap-3 border-b px-5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="text-ink-primary truncate text-[17px] font-[650] tracking-[-0.02em]">
          {title}
        </h1>
        {meta !== undefined ? <MonoMeta className="shrink-0">{meta}</MonoMeta> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
