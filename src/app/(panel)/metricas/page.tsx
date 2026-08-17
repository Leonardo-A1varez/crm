import Link from "next/link";
import { PanelMetricas } from "@/components/metricas/PanelMetricas";
import { PestanasMetricas } from "@/components/metricas/PestanasMetricas";
import { PageHeader } from "@/components/shared/PageHeader";
import { cn } from "@/lib/utils";
import { getMetricsServiceForRequest } from "@/server/bootstrap/metricas-bootstrap";
import { TABS_METRICAS } from "@/types/metricas";
import type { TabMetricas } from "@/types/metricas";

export const dynamic = "force-dynamic";

const VENTANAS = [7, 30, 90] as const;
const VENTANA_POR_DEFECTO = 30;
const TAB_POR_DEFECTO: TabMetricas = "total";
const DIA_MS = 24 * 60 * 60 * 1000;

function leerTab(valor: string | string[] | undefined): TabMetricas {
  return typeof valor === "string" && (TABS_METRICAS as readonly string[]).includes(valor)
    ? (valor as TabMetricas)
    : TAB_POR_DEFECTO;
}

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string | string[]; tab?: string | string[] }>;
}) {
  const params = await searchParams;
  // Param repetido o inválido → ventana por defecto, no error (patrón inbox).
  const pedido = typeof params.dias === "string" ? Number(params.dias) : NaN;
  const dias = (VENTANAS as readonly number[]).includes(pedido) ? pedido : VENTANA_POR_DEFECTO;
  const tab = leerTab(params.tab);

  const svc = await getMetricsServiceForRequest();
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - dias * DIA_MS);
  const m = await svc.obtener(desde, hasta);

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Métricas"
        subtitle={`últimos ${dias} días`}
        actions={
          <div className="flex items-center gap-1">
            {VENTANAS.map((v) => (
              <Link
                key={v}
                href={`/metricas?dias=${v}&tab=${tab}`}
                className={cn(
                  "rounded-[20px] border px-2.5 py-[4.5px] text-[11.5px] font-medium transition-colors",
                  v === dias
                    ? "bg-surface-avatar border-line-control text-ink-primary"
                    : "border-line-card text-ink-dim hover:bg-surface-hover",
                )}
              >
                {v} días
              </Link>
            ))}
          </div>
        }
      />
      <PestanasMetricas activa={tab} dias={dias} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelMetricas m={m} tab={tab} />
      </div>
    </div>
  );
}
