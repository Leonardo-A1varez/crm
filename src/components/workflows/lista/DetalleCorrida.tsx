import Link from "next/link";
import { ArrowForward, PlayIcon, ShieldTope, Warning } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { CaminoRecorrido } from "@/components/workflows/lista/CaminoRecorrido";
import { tinte } from "@/components/workflows/lista/estado";
import { DESCRIPTOR_FIN } from "@/components/workflows/lista/fin-corrida";
import { formatearEntero } from "@/lib/ui/metricas";
import type { DetalleDeCorrida, PasoDeCorrida } from "@/components/workflows/lista/tipos";
import type { ReactNode } from "react";

/**
 * El detalle de una corrida: el flujo dibujado con el camino recorrido a la
 * izquierda y la línea de tiempo paso por paso al costado.
 *
 * Son dos vistas del mismo hecho y ninguna sobra. El dibujo contesta por dónde
 * pasó y dónde se cortó, que es una pregunta espacial y se responde mirando una
 * forma. La línea de tiempo contesta cuándo y cuánto tardó cada cosa, que es
 * cronológica y necesita números alineados. Meter las dos en una sola columna
 * obliga a leer un dibujo como si fuera una tabla.
 */
export function DetalleCorrida({
  detalle,
  hrefSalud,
  acciones,
}: {
  detalle: DetalleDeCorrida;
  /** A dónde va "Ir a salud" cuando el fallo es una plantilla pausada por Meta. */
  hrefSalud: string;
  /** Reanudar y re-ejecutar son mutaciones: las cablea el caller. */
  acciones?: ReactNode;
}) {
  const { corrida, version, cronologia, pasos, entrada, salida, pasosMemoizados, salto } = detalle;
  const fin = DESCRIPTOR_FIN[corrida.fin];
  const Glifo = fin.glifo;
  const fallo = corrida.fin === "fallada";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-line-row bg-surface-panel flex shrink-0 items-start gap-3.5 border-b px-5 py-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <h2 className="text-ink-primary font-mono text-[14px] leading-none font-semibold">
              {corrida.codigo}
            </h2>
            <span
              className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[10.5px] leading-none font-semibold"
              style={{ color: fin.color, backgroundColor: tinte(fin.color, 12) }}
            >
              <Glifo size={11} strokeWidth={2} aria-hidden />
              {fin.label}
              {corrida.codigoError ? (
                <span className="font-mono tabular-nums opacity-75">· {corrida.codigoError}</span>
              ) : null}
            </span>
          </div>
          <p className="text-ink-faint text-[11.5px] leading-relaxed">
            {corrida.leadNombre}
            {corrida.leadVehiculo ? ` · ${corrida.leadVehiculo}` : ""} ·{" "}
            <span className="font-mono">{version}</span> · {cronologia}
          </p>
        </div>
        {acciones ? <div className="flex shrink-0 items-center gap-1.5">{acciones}</div> : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-5">
          {/*
            Qué va a pasar al reanudar, ANTES de que alguien apriete. Reanudar y
            re-ejecutar suenan parecido y hacen cosas muy distintas: una reusa
            los pasos ya hechos, la otra los repite. En un flujo que manda
            WhatsApp, repetirlos significa que el lead recibe dos veces el mismo
            mensaje. Eso no se descubre después de apretar.
          */}
          {fallo && pasosMemoizados > 0 ? (
            <p className="border-line-card bg-surface-input text-ink-secondary flex items-start gap-2.5 rounded-[11px] border px-3.5 py-3 text-[11.5px] leading-relaxed">
              <PlayIcon
                size={13}
                strokeWidth={2}
                className="text-ink-faint mt-px shrink-0"
                aria-hidden
              />
              <span>
                Al reanudar, los{" "}
                <span className="font-mono font-semibold tabular-nums">
                  {formatearEntero(pasosMemoizados)}
                </span>{" "}
                pasos anteriores se reusan y sólo se vuelve a ejecutar el que falló. Nadie recibe
                dos veces el mismo WhatsApp.
              </span>
            </p>
          ) : null}

          {/*
            Una corrida saltada terminó bien: el tope hizo su trabajo. Lo que
            alguien viene a buscar es "¿por qué no le llegó?", y la respuesta va
            arriba, en una frase, antes del dibujo.
          */}
          {salto ? (
            <p
              className="flex items-start gap-2.5 rounded-[11px] px-3.5 py-3 text-[11.5px] leading-relaxed text-pretty"
              style={{
                color: "var(--color-ink-secondary)",
                backgroundColor: tinte("var(--color-special)", 9),
              }}
            >
              <ShieldTope
                size={14}
                strokeWidth={2}
                className="mt-px shrink-0"
                style={{ color: "var(--color-special)" }}
                aria-hidden
              />
              <span>
                <span className="text-ink-primary font-semibold">
                  El lead salió del flujo en «{salto.paso}»: {salto.motivo.toLowerCase()}.
                </span>{" "}
                {salto.explicacion} El mensaje no se mandó y el flujo no siguió.
              </span>
            </p>
          ) : null}

          <div className="flex items-start gap-5">
            <section className="shrink-0">
              <Eyebrow>Camino recorrido</Eyebrow>
              <div className="mt-2.5">
                <CaminoRecorrido pasos={pasos} />
              </div>
            </section>

            <section className="min-w-0 flex-1">
              <Eyebrow>Línea de tiempo</Eyebrow>
              <ol className="mt-2.5 flex flex-col gap-0.5">
                {pasos.map((paso) => (
                  <FilaTiempo key={paso.id} paso={paso} />
                ))}
              </ol>
            </section>
          </div>

          {fallo ? (
            <div className="grid grid-cols-2 gap-3">
              <BloqueDatos titulo="Entrada del paso que falló" lineas={entrada} />
              <BloqueDatos titulo="Salida" lineas={salida} tono="var(--color-danger)" />
            </div>
          ) : null}

          {fallo && corrida.codigoError ? (
            <p
              className="flex items-center gap-3 rounded-[11px] px-3.5 py-3 text-[11.5px] leading-relaxed"
              style={{
                color: "var(--color-caution)",
                backgroundColor: tinte("var(--color-caution)", 9),
              }}
            >
              <Warning size={14} strokeWidth={2} className="shrink-0" aria-hidden />
              <span className="flex-1">
                Si el fallo es una plantilla pausada por Meta, despausarla y reanudar arregla esta
                corrida sin rehacerla. Una plantilla pausada por pacing no se despausa sola.
              </span>
              <Link
                href={hrefSalud}
                className="border-line-card bg-surface-card text-ink-primary hover:bg-surface-hover flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              >
                Ir a salud
                <ArrowForward size={12} aria-hidden />
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Una fila de la línea de tiempo. El estado va escrito, no sólo pintado: es la
 * codificación secundaria que el dibujo de al lado necesita para que el color
 * no quede como único portador.
 */
function FilaTiempo({ paso }: { paso: PasoDeCorrida }) {
  const fantasma = paso.paso === "no-tomado" || paso.paso === "pendiente";
  const color =
    paso.paso === "fallado"
      ? "var(--color-danger)"
      : paso.paso === "saltado"
        ? "var(--color-special)"
        : paso.paso === "recorrido"
          ? "var(--color-ok)"
          : "var(--color-line-control)";

  return (
    <li
      className="flex items-baseline gap-2.5 rounded-[7px] px-2 py-1.5"
      style={
        paso.paso === "fallado" ? { backgroundColor: tinte("var(--color-danger)", 8) } : undefined
      }
    >
      <span
        aria-hidden
        className="size-[6px] shrink-0 translate-y-[-1px] rounded-full"
        style={{
          backgroundColor: fantasma ? "transparent" : color,
          boxShadow: fantasma ? `inset 0 0 0 1.25px ${color}` : undefined,
        }}
      />
      <span
        className={
          fantasma
            ? "text-ink-ghost min-w-0 flex-1 truncate text-[11.5px]"
            : paso.paso === "fallado" || paso.paso === "saltado"
              ? "text-ink-primary min-w-0 flex-1 truncate text-[11.5px] font-semibold"
              : "text-ink-body min-w-0 flex-1 truncate text-[11.5px]"
        }
      >
        {paso.nombre}
        {paso.motivo ? <span className="text-ink-ghost"> · {paso.motivo}</span> : null}
      </span>
      <span className="text-ink-faint shrink-0 font-mono text-[10.5px] tabular-nums">
        {paso.hora ?? "—"}
      </span>
      <span className="text-ink-ghost w-[52px] shrink-0 text-right font-mono text-[10.5px] tabular-nums">
        {paso.duracion ?? "—"}
      </span>
    </li>
  );
}

function BloqueDatos({
  titulo,
  lineas,
  tono,
}: {
  titulo: string;
  lineas: readonly string[];
  tono?: string;
}) {
  const borde = tono ?? "var(--color-line-card)";

  return (
    <section
      className="overflow-hidden rounded-[11px] border"
      style={{ borderColor: tono ? tinte(borde, 35) : borde }}
    >
      <h3
        className="border-b px-3 py-2 font-mono text-[9px] font-semibold tracking-[0.13em] uppercase"
        style={{
          color: tono ?? "var(--color-ink-faint)",
          borderColor: tono ? tinte(borde, 35) : "var(--color-line-row)",
          backgroundColor: tono ? tinte(borde, 8) : "var(--color-surface-input)",
        }}
      >
        {titulo}
      </h3>
      <div className="text-ink-secondary flex flex-col gap-1 px-3 py-2.5 font-mono text-[11px] leading-relaxed">
        {lineas.map((linea) => (
          <span key={linea}>{linea}</span>
        ))}
      </div>
    </section>
  );
}
