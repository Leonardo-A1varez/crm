import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Etiqueta de sección: mono 9px uppercase con tracking ancho. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "text-ink-faint font-mono text-[9px] font-semibold tracking-[0.13em] uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}
