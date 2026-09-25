import { Eyebrow } from "@/components/shared/Eyebrow";
import { anchoTramo } from "./cupo";
import { COLOR_CUPO } from "./paleta";
import { formatearEntero } from "./formato";
import { Cifra, Nota } from "./primitivas";
import type { TandaReparto } from "./tipos";

/**
 * Cuando no entra en una tanda: cuántas plantillas lleva cada una y cuándo
 * arranca. Las tandas son las del planificador, tal cual; acá no se reparte
 * nada.
 *
 * Los mini-rieles usan la misma escala entre sí (lo que entra por tanda) y el
 * mismo color que "esta difusión" en el medidor: es el mismo dato repartido en
 * el tiempo.
 */
export function PlanDeReparto({
  tandas,
  porTanda,
}: {
  tandas: readonly TandaReparto[];
  /** Plantillas por tanda de 24 h, del planificador. */
  porTanda: number;
}) {
  const escala = Math.max(1, porTanda);
  const ultima = tandas.at(-1);

  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>Plan de reparto · {tandas.length} tandas</Eyebrow>
      <ol className="flex flex-col gap-2.5">
        {tandas.map((t) => (
          <li key={t.tanda} className="flex flex-col gap-1">
            <div className="grid grid-cols-[112px_minmax(0,1fr)_86px] items-center gap-3">
              <span className="min-w-0">
                <span className="text-ink-secondary block font-mono text-[11px] font-medium">
                  Tanda {t.tanda + 1}
                </span>
                <span className="text-ink-ghost block truncate text-[10.5px]">{t.desde}</span>
              </span>
              <span className="bg-surface-input h-[7px] min-w-0 overflow-hidden rounded-full">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${anchoTramo(t.porPlantilla, escala)}%`,
                    backgroundColor: COLOR_CUPO.difusion,
                  }}
                />
              </span>
              <Cifra
                valor={formatearEntero(t.porPlantilla)}
                unidad="msj"
                tamano="sm"
                className="w-[86px]"
              />
            </div>
            {t.porVentanaAbierta > 0 ? (
              <span className="text-ink-ghost pl-[124px] text-[10.5px]">
                + {formatearEntero(t.porVentanaAbierta)} por ventana abierta, sin cupo
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {ultima ? (
        <div className="border-line-row flex items-baseline justify-between gap-3 border-t pt-3">
          <span className="text-ink-dim text-[11.5px]">La última arranca</span>
          <span className="text-ink-primary font-mono text-[11.5px] font-medium tabular-nums">
            {ultima.desde}
          </span>
        </div>
      ) : null}
      <Nota>
        Cada tanda lleva a lo sumo {formatearEntero(porTanda)} plantillas: lo que queda del cupo
        menos la reserva, suponiendo que mañana se usa lo mismo que hoy. Dentro de cada tanda sale
        primero quien escribió más recientemente, y los de ventana abierta van todos en la primera:
        mañana su ventana puede estar cerrada.
      </Nota>
    </div>
  );
}
