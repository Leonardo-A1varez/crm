import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import type { ReactNode } from "react";

/**
 * Pantalla de una sección que todavía no se construyó. Existe para que las
 * rutas del nav no muestren texto crudo de TODO: dice qué va a vivir acá y qué
 * sub-proyecto lo construye, en vez de aparentar una pantalla vacía que falla.
 */
export function PantallaPendiente({
  titulo,
  icono,
  descripcion,
  origen,
}: {
  titulo: string;
  icono: ReactNode;
  descripcion: string;
  origen: string;
}) {
  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader title={titulo} meta="sin construir" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyState
          icon={icono}
          title={`${titulo} todavía no está construido`}
          description={descripcion}
          action={
            <span className="text-ink-ghost border-line-control rounded-md border px-2 py-1 font-mono text-[9.5px] tracking-[0.1em] uppercase">
              {origen}
            </span>
          }
        />
      </div>
    </div>
  );
}
