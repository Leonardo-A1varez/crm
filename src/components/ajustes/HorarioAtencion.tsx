import Link from "next/link";
import { SeccionAjuste } from "@/components/ajustes/SeccionAjuste";
import { cn } from "@/lib/utils";

export interface RangoDeAtencion {
  /** "09:00". */
  desde: string;
  hasta: string;
}

export interface FranjaDelDia {
  /** "Lunes", "Martes"… */
  dia: string;
  /** Abreviatura de dos letras para la grilla: "LU". */
  abreviatura: string;
  /**
   * Los turnos del día, en orden. Vacío es cerrado. Puede haber más de uno: un
   * negocio que cierra al mediodía tiene dos, y mostrarlos como uno solo
   * pintaría abierto el mediodía.
   */
  rangos: readonly RangoDeAtencion[];
}

/**
 * El horario de atención.
 *
 * La grilla de la semana es lo que se ve: la pregunta que trae a alguien acá es
 * "¿los sábados atendemos?", y esa se contesta mirando una forma, no leyendo
 * siete filas de horas.
 *
 * Es de sólo lectura. El horario lo guarda y lo usa la consola del agente, así
 * que acá hay un link a ese editor en vez de un segundo formulario que pudiera
 * discrepar del primero.
 *
 * Lo que pasa FUERA del horario se dice explícito, porque es lo que decide si
 * un lead que escribe un domingo a la noche recibe algo o queda esperando.
 */
export function HorarioAtencion({
  franjas,
  zonaHoraria,
  fueraDeHorario,
  editarEn,
}: {
  franjas: readonly FranjaDelDia[];
  zonaHoraria: string;
  /** Qué hace el sistema fuera del horario, en castellano. */
  fueraDeHorario: string;
  /** Dónde se edita. Sin él, no hay link. */
  editarEn?: { href: string; texto: string };
}) {
  return (
    <SeccionAjuste
      titulo="Horario de atención"
      extra={zonaHoraria}
      acciones={
        editarEn ? (
          <Link
            href={editarEn.href}
            className="text-ink-secondary hover:text-ink-primary rounded-[6px] px-2 py-1.5 text-[11px] font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-brand)]"
          >
            {editarEn.texto}
          </Link>
        ) : undefined
      }
      nota="El horario no apaga el webhook: los mensajes entran igual y quedan en la Bandeja. Lo que cambia es si el agente contesta."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <ol className="flex gap-0.5" aria-hidden>
            {franjas.map((f) => {
              const abre = f.rangos.length > 0;
              return (
                <li
                  key={f.dia}
                  className={cn(
                    "flex min-h-[46px] flex-1 flex-col items-center justify-center gap-1 rounded-[8px] px-1 py-1.5",
                    abre ? "bg-surface-input" : "border-line-card border border-dashed",
                  )}
                >
                  <span
                    className={cn(
                      "font-mono text-[10px] font-semibold tracking-[0.08em] uppercase",
                      abre ? "text-ink-secondary" : "text-ink-ghost",
                    )}
                  >
                    {f.abreviatura}
                  </span>
                  {abre ? (
                    f.rangos.map((r) => (
                      <span
                        key={`${r.desde}-${r.hasta}`}
                        className="text-ink-faint font-mono text-[9.5px] tabular-nums"
                      >
                        {`${r.desde}–${r.hasta}`}
                      </span>
                    ))
                  ) : (
                    <span className="text-ink-ghost font-mono text-[9.5px]">cerrado</span>
                  )}
                </li>
              );
            })}
          </ol>
          {/* La grilla es decorativa para el lector de pantalla; esto es lo que
              efectivamente lee, sin tener que reconstruir una tabla. */}
          <p className="sr-only">
            {franjas
              .map((f) =>
                f.rangos.length > 0
                  ? `${f.dia}, ${f.rangos.map((r) => `de ${r.desde} a ${r.hasta}`).join(" y ")}.`
                  : `${f.dia}, cerrado.`,
              )
              .join(" ")}
          </p>
        </div>

        <p className="border-line-card bg-surface-input text-ink-secondary rounded-[11px] border px-3.5 py-3 text-[11.5px] leading-relaxed text-pretty">
          <span className="text-ink-ghost">Fuera de horario: </span>
          {fueraDeHorario}
        </p>
      </div>
    </SeccionAjuste>
  );
}
