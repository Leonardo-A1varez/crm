"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChannelDot } from "@/components/shared/ChannelDot";
import { canalLabel } from "@/lib/ui/canal";
import { cn } from "@/lib/utils";
import { CANAL, type Canal } from "@/types/domain";

/**
 * Valida el `?canal=` de la URL contra los canales conocidos. Cualquier otro
 * valor (ausente, viejo, corrupto) equivale a "Todos" — no hay estado de
 * error para un filtro, solo se ignora. Exportada para que `PanelLista` lea
 * el mismo filtro sin duplicar la validación.
 */
export function parseCanalFilter(raw: string | null): Canal | null {
  return raw !== null && (CANAL as readonly string[]).includes(raw) ? (raw as Canal) : null;
}

const OPCIONES: readonly { canal: Canal | null; label: string }[] = [
  { canal: null, label: "Todos" },
  ...CANAL.map((canal) => ({ canal, label: canalLabel(canal) })),
];

/**
 * Chips de filtro por canal. Reemplaza a `ChannelTabs`. No re-fetchea: cambia
 * el search param con `router.replace` y `PanelLista` relee la misma URL en
 * cliente para filtrar la lista ya cargada — los layouts de Next no reciben
 * `searchParams`, así que este es el único punto de verdad para el filtro.
 */
export function FiltrosCanal() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activo = parseCanalFilter(searchParams.get("canal"));

  function seleccionar(canal: Canal | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (canal) {
      params.set("canal", canal);
    } else {
      params.delete("canal");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div
      role="group"
      aria-label="Filtro por canal"
      className="border-line-layout flex gap-1.5 overflow-x-auto border-b px-3 py-2.5"
    >
      {OPCIONES.map(({ canal, label }) => {
        const isActive = canal === activo;
        return (
          <button
            key={label}
            type="button"
            aria-pressed={isActive}
            onClick={() => seleccionar(canal)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-[20px] border px-[10px] py-[4.5px] text-[11.5px] font-[550] transition-colors",
              isActive
                ? "bg-surface-avatar border-line-control text-ink-primary"
                : "border-line-card text-ink-dim bg-transparent",
            )}
          >
            {canal ? <ChannelDot canal={canal} size={6} /> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}
