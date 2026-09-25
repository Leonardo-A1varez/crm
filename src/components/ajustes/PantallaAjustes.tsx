import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const PESTANAS_AJUSTES = ["salud", "empresa", "usuarios", "horario", "topes"] as const;
export type PestanaAjustes = (typeof PESTANAS_AJUSTES)[number];

export const PESTANA_LABEL: Record<PestanaAjustes, string> = {
  salud: "Salud de WhatsApp",
  empresa: "Empresa",
  usuarios: "Usuarios y roles",
  horario: "Horario de atención",
  topes: "Topes de seguridad",
};

/**
 * El armazón de `/ajustes`, que hasta ahora era un cartel de "pantalla
 * pendiente".
 *
 * "Salud de WhatsApp" va primera, antes que los datos de la empresa. Los otros
 * tres tableros se tocan una vez por año; este decide si mañana se puede
 * vender. El orden de las pestañas es una recomendación de por dónde mirar, y
 * poner primero el formulario del RUC sería recomendar mal.
 *
 * La pestaña de salud lleva un contador cuando hay algo que atender. Es el
 * único aviso que llega sin que nadie entre a buscarlo, y ese es justo el
 * problema que la pantalla viene a resolver: hoy el operador se entera de que
 * lo bloquearon cuando ya no puede vender.
 */
export function PantallaAjustes({
  pestana,
  hrefPestana,
  pendientesDeSalud = 0,
  children,
}: {
  pestana: PestanaAjustes;
  hrefPestana: (pestana: PestanaAjustes) => string;
  /** Cuántas cosas del panel de salud piden una mano ahora mismo. */
  pendientesDeSalud?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Ajustes"
        subtitle="Empresa, accesos, horario, topes de los mensajes automáticos y el estado de la cuenta de WhatsApp."
      />

      <nav
        aria-label="Secciones de ajustes"
        className="border-line-layout bg-surface-panel flex shrink-0 items-center gap-0.5 border-b px-5"
      >
        {PESTANAS_AJUSTES.map((p) => {
          const activa = p === pestana;
          return (
            <Link
              key={p}
              href={hrefPestana(p)}
              aria-current={activa ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 border-b-2 px-3 py-2.5 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-brand)]",
                activa
                  ? "text-ink-primary border-b-[var(--color-brand)] font-[650]"
                  : "text-ink-faint hover:text-ink-secondary border-b-transparent font-medium",
              )}
            >
              {PESTANA_LABEL[p]}
              {p === "salud" && pendientesDeSalud > 0 ? (
                <span
                  className="rounded-full px-1.5 py-px font-mono text-[10px] font-semibold tabular-nums"
                  style={{
                    color: "var(--color-danger)",
                    backgroundColor: "color-mix(in srgb, var(--color-danger) 14%, transparent)",
                  }}
                >
                  {pendientesDeSalud}
                  <span className="sr-only">
                    {pendientesDeSalud === 1 ? " cosa para atender" : " cosas para atender"}
                  </span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
