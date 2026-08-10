"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export const ORDEN = ["triage", "recientes"] as const;
export type Orden = (typeof ORDEN)[number];

/**
 * Lee el `?orden=` de la URL. Triage es el default del handoff: cualquier
 * valor desconocido cae ahí en vez de mostrar un estado de error, igual que el
 * filtro de canal.
 */
export function parseOrden(raw: string | null): Orden {
  return raw === "recientes" ? "recientes" : "triage";
}

const LABEL: Record<Orden, string> = {
  triage: "Triage",
  recientes: "Recientes",
};

/**
 * Segmentado Triage / Recientes. Mismo mecanismo que `FiltrosCanal`: el estado
 * vive en la URL y `PanelLista` la relee en cliente, porque los layouts de Next
 * no reciben `searchParams` y la lista ya está cargada.
 */
export function SelectorOrden() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activo = parseOrden(searchParams.get("orden"));

  function seleccionar(orden: Orden) {
    const params = new URLSearchParams(searchParams.toString());
    if (orden === "triage") {
      params.delete("orden");
    } else {
      params.set("orden", orden);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div
      role="group"
      aria-label="Orden de la lista"
      className="bg-surface-elevated border-line-card mx-3 mt-2.5 flex gap-0.5 rounded-[10px] border p-[3px]"
    >
      {ORDEN.map((orden) => {
        const isActive = orden === activo;
        return (
          <button
            key={orden}
            type="button"
            aria-pressed={isActive}
            onClick={() => seleccionar(orden)}
            className={cn(
              "flex-1 rounded-[7px] py-[3px] text-[11.5px] transition-colors",
              isActive ? "bg-brand text-brand-ink font-semibold" : "text-ink-dim bg-transparent",
            )}
          >
            {LABEL[orden]}
          </button>
        );
      })}
    </div>
  );
}
