import { cn } from "@/lib/utils";
import type { ComponentType, ReactNode } from "react";

/**
 * Chip de procedencia de un campo del Twin: de dónde salió el dato. Los tres
 * del handoff (extraído por IA, corregido por vos, del catálogo) comparten
 * caja y solo cambian de color, para que se lean como una misma dimensión y
 * no como tres etiquetas distintas.
 */
export function ChipProcedencia({
  Icon,
  className,
  titulo,
  children,
}: {
  Icon: ComponentType<{ size?: number; className?: string }>;
  className?: string;
  titulo?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={titulo}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-[5px] px-1.5 py-[1.5px] text-[9px] font-semibold",
        className,
      )}
    >
      <Icon size={10} className="shrink-0" />
      {children}
    </span>
  );
}
