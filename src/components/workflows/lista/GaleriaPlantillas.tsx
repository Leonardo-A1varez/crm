import Link from "next/link";
import { Add, ArrowForward } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { PLANTILLAS } from "@/components/workflows/lista/plantillas";
import type { Plantilla } from "@/components/workflows/lista/plantillas";

/**
 * La galería de plantillas: lo que se abre al crear un flujo.
 *
 * Nunca un lienzo vacío. Un lienzo en blanco con un disparador sin elegir no es
 * libertad, es una pregunta sin contexto: obliga a saber qué bloques existen
 * antes de haber visto uno. "Empezar en blanco" sigue estando, abajo y en gris,
 * que es exactamente el peso que tiene que tener.
 */
export function GaleriaPlantillas({
  hrefVolver,
  hrefPlantilla,
  hrefEnBlanco,
  noCorren,
}: {
  hrefVolver: string;
  /**
   * Por id de plantilla, los bloques de su lienzo que el motor no ejecuta. La
   * tarjeta los avisa antes de abrirla: un flujo con uno de esos no se puede
   * publicar hasta sacarlo. Sale del grafo real de cada plantilla.
   */
  noCorren?: Readonly<Record<string, readonly string[]>>;
  /** A dónde lleva elegir una plantilla: el formulario de parámetros. */
  hrefPlantilla: (id: string) => string;
  hrefEnBlanco: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-line-layout bg-surface-panel flex shrink-0 items-center gap-3.5 border-b px-5 py-[15px]">
        <Link
          href={hrefVolver}
          aria-label="Volver a Flujos"
          className="border-line-card text-ink-secondary hover:bg-surface-hover hover:text-ink-primary flex size-8 shrink-0 items-center justify-center rounded-[9px] border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          <ArrowForward size={15} className="rotate-180" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-ink-primary truncate text-[22px] leading-tight font-[680] tracking-[-0.03em]">
            Nuevo flujo
          </h1>
          {/*
            Las seis plantillas abren el lienzo ya armado (`armarPlantilla`, en
            `workflows/nuevo/_lib/grafos-plantillas.ts`). Lo que depende del
            negocio —qué etiqueta, qué texto— queda vacío y se completa después.
          */}
          <p className="text-ink-faint mt-[3px] text-[12px] text-pretty">
            Elegí por dónde empezar. La plantilla arma los pasos en el lienzo y deja vacío lo que
            depende de tu negocio.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-5">
          <ul className="grid grid-cols-3 gap-3">
            {PLANTILLAS.map((p) => (
              <TarjetaPlantilla
                key={p.id}
                plantilla={p}
                href={hrefPlantilla(p.id)}
                noCorren={noCorren?.[p.id] ?? []}
              />
            ))}
          </ul>

          {/*
            La opción secundaria, y se nota. Borde punteado en vez de sólido,
            fila en vez de tarjeta, y al final de todo: tres señales de que esto
            no es el camino principal. Sigue siendo alcanzable con un tab.
          */}
          <div className="border-line-control relative flex items-center gap-3.5 rounded-[13px] border border-dashed px-4 py-3.5">
            <span
              aria-hidden
              className="bg-surface-input text-ink-faint flex size-7 shrink-0 items-center justify-center rounded-[8px]"
            >
              <Add size={15} strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={hrefEnBlanco}
                className="text-ink-primary rounded-[4px] text-[12.5px] font-[650] after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              >
                Empezar en blanco
              </Link>
              <p className="text-ink-ghost mt-1 text-[11.5px]">
                Lienzo vacío con un disparador sin elegir.
              </p>
            </div>
            <span className="border-line-card text-ink-secondary flex h-7 shrink-0 items-center rounded-[8px] border px-2.5 text-[11.5px] font-medium">
              Abrir lienzo
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TarjetaPlantilla({
  plantilla,
  href,
  noCorren,
}: {
  plantilla: Plantilla;
  href: string;
  noCorren: readonly string[];
}) {
  const { nombre, descripcion, glifo: Glifo, disparador, pasos, reemplaza } = plantilla;

  return (
    <li className="border-line-card bg-surface-card focus-within:border-line-control hover:border-line-control relative flex flex-col gap-3 rounded-[13px] border p-4 transition-colors">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="bg-surface-input text-ink-secondary flex size-7 shrink-0 items-center justify-center rounded-[8px]"
        >
          <Glifo size={15} strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link
            href={href}
            className="text-ink-primary rounded-[4px] text-[13px] leading-tight font-[680] tracking-[-0.01em] text-balance after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            {nombre}
          </Link>
          <p className="text-ink-faint text-[11.5px] leading-relaxed">{descripcion}</p>
        </div>
      </div>

      {/*
        Cuando / Entonces es el vocabulario que el producto ya usa para las
        reglas IF/THEN. Reusarlo acá no es un guiño: es que el lector ya sabe
        leerlo, y una plantilla es exactamente eso —un disparador y una
        consecuencia— sólo que con varios pasos en vez de una respuesta.
      */}
      <div className="border-line-row flex flex-col gap-2 border-t pt-3">
        <div className="flex items-baseline gap-2">
          <Eyebrow className="w-[52px] shrink-0">Cuando</Eyebrow>
          <span className="text-ink-secondary min-w-0 flex-1 text-[11.5px] leading-snug">
            {disparador}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <Eyebrow className="w-[52px] shrink-0">Entonces</Eyebrow>
          <ol className="flex min-w-0 flex-1 flex-col gap-1.5">
            {pasos.map((paso, i) => (
              <li key={paso} className="text-ink-secondary flex gap-2 text-[11.5px] leading-snug">
                <span
                  aria-hidden
                  className="text-ink-ghost w-3 shrink-0 font-mono text-[10.5px] tabular-nums"
                >
                  {i + 1}
                </span>
                <span className="min-w-0">{paso}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {noCorren.length > 0 ? (
        <p className="border-caution/30 bg-caution/10 text-caution rounded-[9px] border px-2.5 py-2 text-[11px] leading-snug text-pretty">
          Trae {noCorren.map((b) => `«${b}»`).join(", ")}, que todavía no se{" "}
          {noCorren.length === 1 ? "ejecuta" : "ejecutan"}: hay que sacarlo antes de publicar.
        </p>
      ) : null}

      <p className="text-ink-ghost border-line-row mt-auto border-t pt-2.5 text-[10.5px] leading-relaxed">
        Reemplaza {reemplaza}.
      </p>
    </li>
  );
}
