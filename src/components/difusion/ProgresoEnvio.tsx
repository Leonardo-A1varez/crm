import { Eyebrow } from "@/components/shared/Eyebrow";
import { DesgloseEntrega } from "./EstadosEntrega";
import { ESTADO_ENTREGA } from "./paleta";
import { formatearEntero } from "./formato";
import { Cifra, Nota } from "./primitivas";
import type { ConteoEntrega, EstadoEntrega, RitmoEnvio, TandaEnvio } from "./tipos";

/**
 * Orden de los tramos de la barra apilada: lo que llegó a la izquierda, el
 * limbo en el medio, lo que falta y los fallos al final. `aceptado` (ámbar) y
 * `fallido` (rojo) nunca se tocan: `en cola` los separa.
 *   node validate_palette.js "#99cbfe,#31d7a5,#f7d710,#5f6672,#f9667c" --mode dark  --surface "#0f1116"
 *   node validate_palette.js "#2362a9,#097957,#8f5509,#757c89,#c52a4d" --mode light --surface "#ffffff"
 *   oscuro: CVD 10.7 · normal 16.9 · contraste 5/5 ≥ 3:1
 *   claro:  CVD  8.3 · normal 15.3 · contraste 5/5 ≥ 3:1
 *
 * `cancelado` no se pinta: es el tramo vacío del final. Pegado a `fallido` da
 * ΔE 3.0 en protanopía (ver `paleta.ts`), y lo cancelado es justamente lo que
 * el envío ya no va a ocupar.
 */
const ORDEN_BARRA: readonly EstadoEntrega[] = [
  "leido",
  "entregado",
  "aceptado",
  "en_cola",
  "fallido",
];

/**
 * El progreso del envío, contado con honestidad.
 *
 * La cifra grande es "llegaron", no "enviados", y son solo `entregado + leído`.
 * Un `aceptado` es un 200 de la Cloud API con un `wamid`: Meta se hizo cargo
 * del pedido y nada más.
 *
 * El ritmo es el medido (lo que el motor reservó en los últimos minutos), y el
 * fin estimado recorre el plan a ese ritmo. Sin ritmo medido no hay fin: se
 * dice cuándo arranca la última tanda, que es un dato del plan.
 */
export function ProgresoEnvio({
  conteo,
  total,
  tandas,
  ritmo,
  respondieron,
}: {
  conteo: ConteoEntrega;
  total: number;
  tandas: readonly TandaEnvio[];
  ritmo?: RitmoEnvio;
  respondieron?: number;
}) {
  const llegaron = conteo.entregado + conteo.leido;
  const pintados = ORDEN_BARRA.filter((e) => conteo[e] > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-2">
          <Eyebrow>Llegaron a un teléfono</Eyebrow>
          <div className="flex items-baseline gap-2">
            <Cifra valor={formatearEntero(llegaron)} tamano="xl" color="var(--color-ok)" />
            <span className="text-ink-faint font-mono text-[12px] tabular-nums">
              / {formatearEntero(total)}
            </span>
          </div>
        </div>

        {respondieron !== undefined ? (
          <div className="flex flex-col gap-2">
            <Eyebrow>Respondieron</Eyebrow>
            <Cifra valor={formatearEntero(respondieron)} tamano="xl" />
          </div>
        ) : null}

        {ritmo ? <LineaRitmo ritmo={ritmo} /> : null}

        {tandas.length > 0 ? (
          <ol aria-label="Tandas del plan" className="ml-auto flex flex-col gap-1 text-right">
            {tandas.map((t) => (
              <li key={t.tanda} className="text-ink-dim text-[11px]">
                <span className="text-ink-secondary font-mono font-medium">
                  Tanda {t.tanda + 1}
                </span>{" "}
                · desde {t.desde} ·{" "}
                <span className="font-mono tabular-nums">{formatearEntero(t.total)}</span>
                {t.enCola > 0 ? (
                  <>
                    {" "}
                    (<span className="font-mono tabular-nums">{formatearEntero(t.enCola)}</span> en
                    cola)
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <div className="bg-surface-input flex h-3 overflow-hidden rounded-[6px]" aria-hidden>
        {pintados.map((estado, i) => (
          <div
            key={estado}
            className={
              i < pintados.length - 1
                ? "border-surface-card h-full border-r-2 transition-[width] duration-500 ease-out"
                : "h-full transition-[width] duration-500 ease-out"
            }
            style={{
              width: `${total > 0 ? (conteo[estado] / total) * 100 : 0}%`,
              backgroundColor: ESTADO_ENTREGA[estado].color,
            }}
          />
        ))}
      </div>

      <DesgloseEntrega conteo={conteo} total={total} />

      <Nota>
        <strong className="text-ink-secondary font-semibold">Aceptado no es entregado.</strong> Los{" "}
        <span className="font-mono tabular-nums">{formatearEntero(conteo.aceptado)}</span> aceptados
        tienen <span className="font-mono">wamid</span> y un 200 de la API, y todavía no llegaron a
        ningún teléfono. Nunca se cuentan como enviados.
        {conteo.cancelado > 0
          ? " Los cancelados no se pintan en la barra: son el tramo vacío del final."
          : ""}
      </Nota>
    </div>
  );
}

/** "Ritmo 2 msg/s · termina 01/09 14:20", o lo que el plan sabe sin ritmo. */
function LineaRitmo({ ritmo }: { ritmo: RitmoEnvio }) {
  return (
    <p className="text-ink-dim flex flex-col gap-1 text-[11.5px] leading-snug">
      {ritmo.porSegundo === null ? (
        <span>Sin envíos en los últimos 5 minutos: no hay ritmo medido.</span>
      ) : (
        <span>
          Ritmo{" "}
          <span className="text-ink-primary font-mono font-medium tabular-nums">
            {ritmo.porSegundo < 10
              ? ritmo.porSegundo.toFixed(1).replace(".", ",")
              : formatearEntero(Math.round(ritmo.porSegundo))}{" "}
            msg/s
          </span>{" "}
          en los últimos 5 minutos
        </span>
      )}
      {ritmo.finEstimado ? (
        <span>
          Termina{" "}
          <span className="text-ink-primary font-mono font-medium tabular-nums">
            {ritmo.finEstimado}
          </span>{" "}
          si el ritmo se sostiene
        </span>
      ) : ritmo.ultimaTandaDesde ? (
        <span>
          La última tanda arranca{" "}
          <span className="text-ink-primary font-mono font-medium tabular-nums">
            {ritmo.ultimaTandaDesde}
          </span>
        </span>
      ) : null}
    </p>
  );
}
