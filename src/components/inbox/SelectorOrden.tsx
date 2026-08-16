"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export const ORDEN = ["triage", "recientes", "seguimiento"] as const;
export type Orden = (typeof ORDEN)[number];

/**
 * Lee el `?orden=` de la URL. Triage es el default del handoff: cualquier
 * valor desconocido cae ahí en vez de mostrar un estado de error, igual que el
 * filtro de canal.
 */
export function parseOrden(raw: string | null): Orden {
  if (raw === "recientes") return "recientes";
  if (raw === "seguimiento") return "seguimiento";
  return "triage";
}

const LABEL: Record<Orden, string> = {
  triage: "Triage",
  recientes: "Recientes",
  seguimiento: "Seguimiento",
};

/**
 * Segmentado Triage / Recientes / Seguimiento. El estado vive en la URL y
 * `PanelLista` la relee en cliente, porque los layouts de Next no reciben
 * `searchParams` y la lista ya está cargada.
 *
 * El contador de Seguimiento se muestra **esté o no activo el chip**: es el
 * aviso de cuántos leads tienen algo agendado, y esconderlo detrás de un click
 * lo volvería inútil. Cuando no hay ninguno no se dibuja, para no poner un cero
 * que compite por atención con los otros dos chips.
 */
export function SelectorOrden({ conSeguimiento }: { conSeguimiento: number }) {
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
        const badge = orden === "seguimiento" && conSeguimiento > 0 ? conSeguimiento : null;
        return (
          <button
            key={orden}
            type="button"
            aria-pressed={isActive}
            aria-label={
              badge === null
                ? undefined
                : `${LABEL[orden]}, ${badge} lead${badge === 1 ? "" : "s"} con seguimiento`
            }
            onClick={() => seleccionar(orden)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-[7px] py-[3px] text-[11.5px] transition-colors",
              isActive ? "bg-brand text-brand-ink font-semibold" : "text-ink-dim bg-transparent",
            )}
          >
            {LABEL[orden]}
            {badge === null ? null : (
              <span
                className={cn(
                  "min-w-[15px] rounded-full px-[4px] text-center font-mono text-[9.5px] leading-[14px] font-semibold",
                  isActive ? "bg-brand-ink/15 text-brand-ink" : "bg-brand/15 text-brand",
                )}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
