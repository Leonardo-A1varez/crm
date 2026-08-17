import { Handyman } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";

/**
 * Estado honesto para las métricas del handoff §3 que hoy no se pueden
 * calcular. Dice qué iba a ir en ese lugar y qué falta para poder medirlo, en
 * vez de un guion sin explicación o —peor— un número de ejemplo: la pantalla es
 * para decidir, y un dato inventado ahí adentro es un error de negocio.
 *
 * El borde punteado es la señal de que el bloque no es un dato: ningún otro
 * componente de la pantalla lo usa.
 */
function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line-control bg-surface-card/40 rounded-[15px] border border-dashed px-[17px] py-4">
      {children}
    </div>
  );
}

function Encabezado({ label }: { label: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <Eyebrow className="text-ink-ghost">{label}</Eyebrow>
      <Handyman size={19} className="text-line-control shrink-0" aria-hidden />
    </div>
  );
}

function Falta({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-ink-faint mt-2 text-[10.5px] leading-relaxed">
      <span className="text-ink-ghost font-mono text-[9px] font-semibold tracking-[0.13em] uppercase">
        falta{" "}
      </span>
      {children}
    </p>
  );
}

/** Del tamaño de una `TarjetaKpi`, para ocupar su lugar en la grilla de KPIs. */
export function KpiFaltante({ label, falta }: { label: string; falta: string }) {
  return (
    <Marco>
      <Encabezado label={label} />
      <span
        className="text-line-control mt-2 block font-mono text-[28px] leading-none font-semibold tracking-[-0.035em]"
        aria-hidden
      >
        ——
      </span>
      <Falta>{falta}</Falta>
    </Marco>
  );
}
