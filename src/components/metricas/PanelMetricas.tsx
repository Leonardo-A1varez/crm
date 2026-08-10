import { PanelAgente } from "@/components/metricas/PanelAgente";
import { PanelTotal } from "@/components/metricas/PanelTotal";
import { PanelVendedores } from "@/components/metricas/PanelVendedores";
import type { Metricas, TabMetricas } from "@/types/metricas";

/** Despacha el corte activo del handoff §3. Las tres pestañas comen las mismas métricas. */
export function PanelMetricas({ m, tab }: { m: Metricas; tab: TabMetricas }) {
  if (tab === "agente") return <PanelAgente m={m} />;
  if (tab === "vendedores") return <PanelVendedores m={m} />;
  return <PanelTotal m={m} />;
}
