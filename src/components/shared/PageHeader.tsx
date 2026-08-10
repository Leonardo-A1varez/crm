import type { ReactNode } from "react";

/**
 * Encabezado de pantalla, con los valores del handoff (§2, §3 y §4 usan el
 * mismo patrón): título de 22px con el subtítulo debajo, y las acciones a la
 * derecha. El contador vive en el subtítulo y no en un chip aparte, que es
 * como lo especifica el handoff para Leads y Métricas.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="border-line-layout bg-surface-panel flex shrink-0 items-center justify-between gap-4 border-b px-5 py-[15px]">
      <div className="min-w-0">
        <h1 className="text-ink-primary truncate text-[22px] leading-tight font-[680] tracking-[-0.03em]">
          {title}
        </h1>
        {subtitle !== undefined ? (
          <p className="text-ink-faint mt-[3px] truncate text-[12px]">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
