import { cn } from "@/lib/utils";
import type { Descriptor } from "@/components/ajustes/descriptores";

/**
 * Badge de estado del panel de salud: glifo, palabra y recién después color.
 * Ver `descriptores.ts` para los números que obligan a ese orden.
 *
 * El glifo va `aria-hidden`: dice lo mismo que la palabra de al lado y
 * anunciarlo dos veces sólo alarga la lectura del lector de pantalla.
 */
export function BadgeSalud({
  descriptor,
  className,
}: {
  descriptor: Descriptor;
  className?: string;
}) {
  const { label, glifo: Glifo, color } = descriptor;

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-[6px] px-2 py-1 text-[10.5px] leading-none font-semibold",
        className,
      )}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      <Glifo size={11} strokeWidth={2.25} aria-hidden />
      {label}
    </span>
  );
}
