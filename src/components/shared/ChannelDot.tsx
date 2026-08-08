import { canalColor, canalLabel } from "@/lib/ui/canal";
import { cn } from "@/lib/utils";
import type { Canal } from "@/types/domain";

/**
 * `ringColor` dibuja el borde del color de la superficie de fondo: es lo que
 * despega el punto cuando se superpone a un avatar.
 */
export function ChannelDot({
  canal,
  size = 6,
  ringColor,
  className,
}: {
  canal: Canal;
  size?: number;
  ringColor?: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={canalLabel(canal)}
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: canalColor(canal),
        ...(ringColor ? { border: `2.5px solid ${ringColor}` } : {}),
      }}
    />
  );
}
