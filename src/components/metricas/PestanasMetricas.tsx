import Link from "next/link";
import { AutoAwesome, Dashboard, Group } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { TabMetricas } from "@/types/metricas";
import type { LucideIcon } from "lucide-react";

const PESTANAS: { tab: TabMetricas; label: string; icono: LucideIcon; aclaracion: string }[] = [
  { tab: "total", label: "Total", icono: Dashboard, aclaracion: "IA + vendedores combinados" },
  {
    tab: "agente",
    label: "Agente IA",
    icono: AutoAwesome,
    aclaracion: "solo turnos resueltos por el agente",
  },
  {
    tab: "vendedores",
    label: "Vendedores",
    icono: Group,
    aclaracion: "solo conversaciones tomadas por humanos",
  },
];

/**
 * Los tres cortes del handoff §3. Son links y no estado de cliente para que la
 * vista sea compartible y sobreviva a un refresh, igual que el selector de días.
 * La ventana viaja en el href: cambiar de pestaña no debe resetearla.
 */
export function PestanasMetricas({ activa, dias }: { activa: TabMetricas; dias: number }) {
  const aclaracion = PESTANAS.find((p) => p.tab === activa)?.aclaracion;

  return (
    <div className="border-line-layout bg-surface-panel flex shrink-0 items-center justify-between gap-4 border-b px-5">
      <nav className="flex items-center gap-1" aria-label="Corte de métricas">
        {PESTANAS.map(({ tab, label, icono: Icono }) => {
          const esActiva = tab === activa;
          return (
            <Link
              key={tab}
              href={`/metricas?dias=${dias}&tab=${tab}`}
              aria-current={esActiva ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[12.5px] font-semibold transition-colors",
                esActiva
                  ? "border-brand text-ink-primary"
                  : "text-ink-faint hover:text-ink-secondary border-transparent",
              )}
            >
              <Icono size={16} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      {aclaracion ? (
        <span className="text-ink-ghost hidden shrink-0 text-[10.5px] sm:inline">{aclaracion}</span>
      ) : null}
    </div>
  );
}
