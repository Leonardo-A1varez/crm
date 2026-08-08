import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Texto mono chico para timestamps, IDs, SKUs y meta técnica. Regla
 * tipográfica del handoff: todo dato que se compara o se escanea va en mono.
 */
export function MonoMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-ink-faint font-mono text-[10px]", className)}>{children}</span>;
}
