"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GestionCampanias } from "@/components/metricas/GestionCampanias";
import { cn } from "@/lib/utils";
import type { CampaniaFormValues } from "@/components/metricas/CampaniaFormDialog";
import type { ActionResult } from "@/types/inbox";
import type { Campania } from "@/types/entities";

const ATAJOS = [7, 30, 90] as const;

function aInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * "N días" es N días de calendario completos, hoy incluido — no N×24h
 * contadas desde el instante actual. `hasta` es siempre el día de hoy;
 * `desde` es hoy menos (N-1) días. page.tsx le aplica a `hasta` el mismo
 * límite exclusivo +1 día que al resto de las fuentes (rango libre,
 * campaña): por eso acá tiene que viajar como día de calendario, igual
 * que las otras, y no como instante exacto.
 */
function rangoDeAtajo(dias: number): { desde: string; hasta: string } {
  const hoy = aInputDate(new Date());
  const hastaDate = new Date(`${hoy}T00:00:00.000Z`);
  const desdeDate = new Date(hastaDate.getTime() - (dias - 1) * DIA_MS);
  return { desde: aInputDate(desdeDate), hasta: hoy };
}

export function SelectorRango({
  tab,
  desde,
  hasta,
  campaniaId,
  campanias,
  onCrearCampania,
  onEditarCampania,
  onBorrarCampania,
}: {
  tab: string;
  desde: string;
  hasta: string;
  campaniaId: string | null;
  campanias: Campania[];
  onCrearCampania: (values: CampaniaFormValues) => Promise<ActionResult>;
  onEditarCampania: (input: CampaniaFormValues & { id: string }) => Promise<ActionResult>;
  onBorrarCampania: (input: { id: string }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const irA = (params: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(params)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`);
  };

  const atajoActivo = ATAJOS.find((n) => {
    const r = rangoDeAtajo(n);
    return r.desde === desde && r.hasta === hasta && campaniaId === null;
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        {ATAJOS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => irA({ ...rangoDeAtajo(n), tab, campania: null })}
            className={cn(
              "rounded-[20px] border px-2.5 py-[4.5px] text-[11.5px] font-medium transition-colors",
              atajoActivo === n
                ? "bg-surface-avatar border-line-control text-ink-primary"
                : "border-line-card text-ink-dim hover:bg-surface-hover",
            )}
          >
            {n} días
          </button>
        ))}
      </div>

      <input
        type="date"
        value={desde}
        onChange={(e) => irA({ desde: e.target.value, tab, campania: null })}
        className="border-line-card bg-surface-card text-ink-dim rounded-[8px] border px-2 py-1 text-[11.5px]"
        aria-label="Desde"
      />
      <span className="text-ink-ghost text-[11px]">–</span>
      <input
        type="date"
        value={hasta}
        onChange={(e) => irA({ hasta: e.target.value, tab, campania: null })}
        className="border-line-card bg-surface-card text-ink-dim rounded-[8px] border px-2 py-1 text-[11.5px]"
        aria-label="Hasta"
      />

      {campanias.length > 0 ? (
        <select
          value={campaniaId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            const c = campanias.find((x) => x.id === id);
            if (!c) return;
            irA({ desde: aInputDate(c.desde), hasta: aInputDate(c.hasta), campania: id, tab });
          }}
          className="border-line-card bg-surface-card text-ink-dim rounded-[8px] border px-2 py-1 text-[11.5px]"
          aria-label="Campaña"
        >
          <option value="">Campaña…</option>
          {campanias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      ) : null}

      <GestionCampanias
        campanias={campanias}
        onCrear={onCrearCampania}
        onEditar={onEditarCampania}
        onBorrar={onBorrarCampania}
      />
    </div>
  );
}
