import { Eyebrow } from "@/components/shared/Eyebrow";
import type { Delta, SentidoDelta } from "@/lib/ui/metricas";
import type { LucideIcon } from "lucide-react";

const COLOR_DELTA: Record<SentidoDelta, string> = {
  sube: "var(--color-ok)",
  baja: "var(--color-danger)",
  igual: "var(--color-info)",
};

/**
 * Tarjeta KPI del handoff §3: el mismo patrón en las tres pestañas. El ícono es
 * decorativo (`aria-hidden`): repite lo que ya dice el label y anunciarlo solo
 * agrega ruido al lector de pantalla.
 */
export function TarjetaKpi({
  label,
  valor,
  subtitulo,
  delta,
  icono: Icono,
}: {
  label: string;
  valor: string;
  subtitulo: string;
  delta?: Delta | null;
  icono: LucideIcon;
}) {
  return (
    <article className="border-line-card bg-surface-card relative rounded-[15px] border px-[17px] py-4">
      <Icono size={19} className="text-line-control absolute top-4 right-[17px]" aria-hidden />
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-ink-primary font-mono text-[28px] leading-none font-semibold tracking-[-0.035em]">
          {valor}
        </span>
        {delta ? (
          <span className="text-[11px] font-semibold" style={{ color: COLOR_DELTA[delta.sentido] }}>
            {delta.texto}
          </span>
        ) : null}
      </div>
      <p className="text-ink-faint mt-[7px] text-[10.5px]">{subtitulo}</p>
    </article>
  );
}
