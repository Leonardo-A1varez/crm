import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CurrentStage } from "@/types/domain";

// Alpha en bg (en vez de dark:bg-*) mantiene contraste en ambos temas con una sola clase.
const STAGE_CONFIG: Record<CurrentStage, { label: string; className: string }> = {
  nuevo: { label: "Nuevo", className: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  identificando: {
    label: "Identificando",
    className: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  },
  cotizado: {
    label: "Cotizado",
    className: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  },
  negociando: {
    label: "Negociando",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  esperando_pago: {
    label: "Esperando pago",
    className: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  },
  cerrado: {
    label: "Cerrado",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  perdido: { label: "Perdido", className: "bg-red-500/15 text-red-700 dark:text-red-400" },
  requiere_humano: {
    label: "Requiere humano",
    className: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400",
  },
};

export function StageBadge({ stage }: { stage: CurrentStage }) {
  const { label, className } = STAGE_CONFIG[stage];
  return (
    <Badge variant="secondary" className={cn("text-xs", className)}>
      {label}
    </Badge>
  );
}
