import { initials } from "@/lib/ui/initials";
import { cn } from "@/lib/utils";

/** Radio y tamaño de fuente por tamaño, según el handoff. */
const ESTILOS = {
  26: { radius: 8, font: 10 },
  28: { radius: 9, font: 10.5 },
  36: { radius: 11, font: 12 },
  38: { radius: 12, font: 12.5 },
} as const;

export type AvatarSize = keyof typeof ESTILOS;

export function InitialsAvatar({
  nombre,
  size = 38,
  className,
}: {
  nombre: string;
  size?: AvatarSize;
  className?: string;
}) {
  const { radius, font } = ESTILOS[size];
  return (
    <span
      aria-hidden
      className={cn(
        "bg-surface-avatar text-ink-secondary inline-flex shrink-0 items-center justify-center font-semibold",
        className,
      )}
      style={{ width: size, height: size, borderRadius: radius, fontSize: font }}
    >
      {initials(nombre)}
    </span>
  );
}
