import Link from "next/link";
import { AvisoLectura } from "@/components/ajustes/AvisoLectura";
import { SeccionAjuste } from "@/components/ajustes/SeccionAjuste";
import { ShieldTope } from "@/components/icons";
import { formatearEntero } from "@/lib/ui/metricas";
import { cn } from "@/lib/utils";
import type { Lectura } from "@/components/ajustes/tipos";
import type { ReactNode } from "react";
import type { MotivoSalto } from "@/types/workflows";

/** Un motivo de salto con su cuenta de la ventana. */
export interface SaltoPorMotivo {
  motivo: MotivoSalto;
  label: string;
  explicacion: string;
  cantidad: number;
}

export interface SaltosDeLaSemana {
  filas: readonly SaltoPorMotivo[];
  total: number;
}

function tinte(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/**
 * Los topes de seguridad de los mensajes automáticos (PRD workflows §6.6).
 *
 * Son tres y se dicen los tres, aunque dos no se configuran: la pregunta que
 * trae a alguien acá es "¿qué impide que el sistema le escriba de más a un
 * cliente?", y la respuesta completa incluye lo que está siempre prendido.
 *
 * El número que sí se configura —mensajes por lead cada 24 h— se muestra y no
 * se edita acá. Vive en la configuración del agente, que es versionada: un
 * segundo formulario tendría que duplicar ese versionado o saltearlo. Mismo
 * criterio que el horario de atención.
 *
 * Al lado, lo que los topes hicieron de verdad: cuántos mensajes saltó cada
 * uno en la última semana, contados en la base. Un tope que nunca salta y uno
 * que salta cien veces por día piden cosas distintas, y sin el número no se
 * sabe cuál es cuál.
 */
export function TopesSeguridad({
  maximoPorLead,
  editarEn,
  saltos,
}: {
  /** `agente_config.max_salientes_automaticos_24h`. */
  maximoPorLead: Lectura<number>;
  editarEn: { href: string; texto: string };
  saltos: Lectura<SaltosDeLaSemana>;
}) {
  return (
    <div className="grid max-w-[1120px] items-start gap-3.5 lg:grid-cols-[1.25fr_1fr]">
      <SeccionAjuste
        titulo="Topes de seguridad"
        acciones={
          <Link
            href={editarEn.href}
            className="text-ink-secondary hover:text-ink-primary rounded-[6px] px-2 py-1.5 text-[11px] font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-brand)]"
          >
            {editarEn.texto}
          </Link>
        }
        nota="Valen para todos los flujos automáticos, por encima de lo que diga cada uno. Cuando un tope salta un mensaje, el lead sale del flujo: no pasa al paso siguiente."
      >
        <ul className="flex flex-col">
          <FilaTope
            titulo="Mensajes automáticos por lead"
            detalle="Cuenta los que mandaron los flujos en las últimas 24 horas. Al llegar al tope, el siguiente no sale."
            valor={
              maximoPorLead.estado === "ok" ? (
                <span className="text-ink-primary font-mono text-[13px] font-semibold tabular-nums">
                  {formatearEntero(maximoPorLead.datos)}
                  <span className="text-ink-faint font-sans text-[11px] font-medium">
                    {" "}
                    cada 24 h
                  </span>
                </span>
              ) : (
                <span className="text-ink-faint text-[11px]">Sin leer</span>
              )
            }
          />
          <FilaTope
            titulo="Leads en «requiere humano»"
            detalle="Una persona está a cargo de la conversación: ningún flujo le escribe."
            valor={<SiempreActivo />}
          />
          <FilaTope
            titulo="Leads dados de baja"
            detalle="Quien pidió no recibir más mensajes no recibe ninguno automático, nunca."
            valor={<SiempreActivo />}
          />
        </ul>
        {maximoPorLead.estado !== "ok" ? (
          <div className="pt-3.5">
            <AvisoLectura titulo="Mensajes automáticos por lead" lectura={maximoPorLead} />
          </div>
        ) : null}
      </SeccionAjuste>

      {saltos.estado === "ok" ? (
        <SaltosRecientes saltos={saltos.datos} />
      ) : (
        <AvisoLectura titulo="Mensajes saltados" lectura={saltos} />
      )}
    </div>
  );
}

function FilaTope({
  titulo,
  detalle,
  valor,
}: {
  titulo: string;
  detalle: string;
  valor: ReactNode;
}) {
  return (
    <li className="border-line-row flex items-center justify-between gap-4 border-b py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-ink-body text-[12px] font-medium">{titulo}</p>
        <p className="text-ink-faint max-w-[52ch] text-[10.5px] leading-relaxed text-pretty">
          {detalle}
        </p>
      </div>
      <div className="shrink-0">{valor}</div>
    </li>
  );
}

/**
 * "Siempre activo" con escudo y palabra: el estado no depende del color. No
 * es un botón ni un switch, porque no se puede apagar.
 */
function SiempreActivo() {
  const color = "var(--color-special)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[10.5px] leading-none font-semibold whitespace-nowrap"
      style={{ color, backgroundColor: tinte(color, 12) }}
    >
      <ShieldTope size={11} strokeWidth={2.25} aria-hidden />
      Siempre activo
    </span>
  );
}

function SaltosRecientes({ saltos }: { saltos: SaltosDeLaSemana }) {
  return (
    <SeccionAjuste
      titulo="Mensajes saltados"
      extra="últimos 7 días"
      nota="Cuenta los mensajes de flujos que un tope no dejó salir. Las pruebas del editor no cuentan. Cada salto queda en el historial de la corrida con su motivo."
    >
      <div className="flex flex-col gap-4">
        <p className="flex items-baseline gap-2">
          <span className="text-ink-primary font-mono text-[26px] leading-none font-semibold tabular-nums">
            {formatearEntero(saltos.total)}
          </span>
          <span className="text-ink-faint text-[11.5px]">
            {saltos.total === 1 ? "mensaje no salió" : "mensajes no salieron"}
          </span>
        </p>

        <ul className="flex flex-col gap-0.5" aria-label="Mensajes saltados por motivo">
          {saltos.filas.map((fila) => (
            <li
              key={fila.motivo}
              className="flex items-baseline gap-3 rounded-[7px] px-2 py-1.5 [&:nth-child(odd)]:bg-[var(--color-surface-input)]"
            >
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-[11.5px] font-medium",
                    fila.cantidad > 0 ? "text-ink-body" : "text-ink-faint",
                  )}
                >
                  {fila.label}
                </p>
                <p className="text-ink-ghost text-[10.5px] leading-relaxed text-pretty">
                  {fila.explicacion}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 font-mono text-[12.5px] font-semibold tabular-nums",
                  fila.cantidad > 0 ? "text-ink-primary" : "text-ink-ghost",
                )}
              >
                {formatearEntero(fila.cantidad)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </SeccionAjuste>
  );
}
