import { BarChartIcon } from "@/components/icons";
import { PantallaPendiente } from "@/components/shared/PantallaPendiente";

export default function MetricasPage() {
  return (
    <PantallaPendiente
      titulo="Métricas"
      icono={<BarChartIcon size={34} strokeWidth={1.4} />}
      descripcion="Va a mostrar el embudo de las 6 etapas y los tres cortes del handoff: volumen por canal, resultado de las sesiones y reparto entre lo que contestó la IA y lo que contestó un vendedor."
      origen="sub-proyecto F"
    />
  );
}
