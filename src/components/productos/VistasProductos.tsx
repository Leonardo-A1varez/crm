import Link from "next/link";
import { cn } from "@/lib/utils";

const BASE =
  "inline-flex items-center rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-semibold transition-colors";

/** Selector de vista de Productos para admin: catálogo o búsquedas sin resultado. */
export function VistasProductos({ activa }: { activa: "catalogo" | "sin-resultado" }) {
  return (
    <nav aria-label="Vistas de productos" className="flex items-center gap-1.5">
      <Link
        href="/productos"
        aria-current={activa === "catalogo" ? "page" : undefined}
        className={cn(
          BASE,
          activa === "catalogo"
            ? "border-line-control bg-surface-hover text-ink-primary"
            : "text-ink-secondary hover:bg-surface-hover border-transparent",
        )}
      >
        Catálogo
      </Link>
      <Link
        href="/productos?vista=sin-resultado"
        aria-current={activa === "sin-resultado" ? "page" : undefined}
        className={cn(
          BASE,
          activa === "sin-resultado"
            ? "border-line-control bg-surface-hover text-ink-primary"
            : "text-ink-secondary hover:bg-surface-hover border-transparent",
        )}
      >
        Sin resultado
      </Link>
    </nav>
  );
}
