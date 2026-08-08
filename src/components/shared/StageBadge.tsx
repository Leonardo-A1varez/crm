import { stageBadgeBackground, stageColor, stageLabel } from "@/lib/ui/stage";
import { cn } from "@/lib/utils";
import type { CurrentStage } from "@/types/domain";

/** Color de la etapa sobre ese mismo color al 13% de alpha. */
export function StageBadge({ stage, className }: { stage: CurrentStage; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-[7px] py-[2.5px] text-[10px] font-semibold",
        className,
      )}
      style={{ color: stageColor(stage), backgroundColor: stageBadgeBackground(stage) }}
    >
      {stageLabel(stage)}
    </span>
  );
}
