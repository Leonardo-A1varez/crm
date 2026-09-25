import { BadgeSalud } from "@/components/ajustes/BadgeSalud";
import { DESCRIPTOR_ENVIO } from "@/components/ajustes/descriptores";
import { Done, HelpIcon, Warning } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { cn } from "@/lib/utils";
import type {
  EnvioSegunMeta,
  EscalonSancion,
  PosicionEnEscalera,
} from "@/components/ajustes/tipos";

function tinte(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/**
 * La escalera de sanciones de Meta.
 *
 * ===================== QUÉ PROBLEMA RESUELVE =====================
 *
 * El operador se entera de que lo sancionaron cuando ya no puede vender. La
 * sanción no llega de golpe: es una escalera, y antes del bloqueo hay una
 * advertencia. Esta pieza muestra la escalera y, cuando se sabe, el escalón.
 *
 * ===================== LO QUE SE SABE Y LO QUE NO =====================
 *
 * Meta no expone el escalón por API: lo avisa por el webhook `account_update`.
 * Mientras esa fuente no exista, la posición llega `no-disponible` y la
 * escalera se dibuja como REFERENCIA —todos los escalones iguales, con lo que
 * se pierde en cada uno— y un recuadro dice que no se sabe dónde está la
 * cuenta. Lo que sí se lee es el `health_status`: si la cuenta puede mandar,
 * está limitada o bloqueada. Va en el encabezado, con el texto de Meta.
 *
 * "Sin sanciones" en verde sólo se dibuja si alguien lo sabe. Afirmarlo por no
 * haber podido leer lo contrario es el error que esta pantalla viene a evitar.
 *
 * ===================== CÓMO ESTÁ DIBUJADA =====================
 *
 *   - NO hay cinco colores: sobre esta paleta ámbar y rojo apenas se separan
 *     en deuteranopía. El color se gasta en un solo lugar: dónde estás.
 *   - La gravedad la lleva el ORDEN y las duraciones, que son las de la
 *     política, no una escala inventada.
 *   - El espinazo es lleno por arriba del escalón actual y rayado por abajo:
 *     lleno es lo que ya pasó, rayado lo que podría pasar. En modo referencia
 *     es rayado entero: todavía no pasó nada que se sepa.
 */
export function EscaleraSanciones({
  escalones,
  posicion,
  envio,
  nota,
}: {
  escalones: readonly EscalonSancion[];
  posicion: PosicionEnEscalera;
  /** El `health_status` agregado de la cuenta. */
  envio: EnvioSegunMeta;
  /** Lo que la política dice de la escalera en general. Va al pie. */
  nota?: string;
}) {
  const pie = [piePorPosicion(posicion), nota].filter((t): t is string => Boolean(t)).join(" ");

  return (
    <section className="border-line-card bg-surface-card flex flex-col gap-3.5 rounded-[14px] border p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Eyebrow>Escalera de sanciones</Eyebrow>
        {posicion.tipo === "sin-sancion" ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[10.5px] leading-none font-semibold"
            style={{ color: "var(--color-ok)", backgroundColor: tinte("var(--color-ok)", 12) }}
          >
            <Done size={11} strokeWidth={2.5} aria-hidden />
            sin sanciones
          </span>
        ) : null}
        <BadgeSalud descriptor={DESCRIPTOR_ENVIO[envio.estado]} className="ml-auto" />
      </div>

      {envio.estado === "limitado" || envio.estado === "bloqueado" ? (
        <p
          className="rounded-[9px] px-3 py-2 text-[11px] leading-relaxed text-pretty"
          style={{
            color: DESCRIPTOR_ENVIO[envio.estado].color,
            backgroundColor: tinte(DESCRIPTOR_ENVIO[envio.estado].color, 9),
          }}
        >
          <span className="font-semibold">Meta dice:</span> {envio.detalle}
        </p>
      ) : null}

      {posicion.tipo === "no-disponible" ? (
        <div className="bg-surface-input flex items-start gap-2.5 rounded-[11px] px-3.5 py-3">
          <HelpIcon
            size={14}
            strokeWidth={2.25}
            className="text-ink-faint mt-px shrink-0"
            aria-hidden
          />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-ink-primary text-[11.5px] leading-snug font-[650]">
              No se sabe en qué escalón está la cuenta.
            </p>
            <p className="text-ink-secondary text-[11px] leading-relaxed text-pretty">
              {posicion.motivo}
            </p>
          </div>
        </div>
      ) : null}

      <ol className="flex flex-col">
        {escalones.map((escalon, i) => (
          <Escalon
            key={escalon.id}
            escalon={escalon}
            lugar={lugarDe(posicion, i)}
            desde={posicion.tipo === "en-escalon" ? posicion.desde : null}
            ultimo={i === escalones.length - 1}
          />
        ))}
      </ol>

      {pie.length > 0 ? (
        <p className="text-ink-ghost text-[10.5px] leading-relaxed text-pretty">{pie}</p>
      ) : null}
    </section>
  );
}

type Lugar = "pasado" | "actual" | "siguiente" | "futuro" | "referencia";

function lugarDe(posicion: PosicionEnEscalera, i: number): Lugar {
  switch (posicion.tipo) {
    case "no-disponible":
      return "referencia";
    case "sin-sancion":
      return i === 0 ? "siguiente" : "futuro";
    case "en-escalon":
      if (i < posicion.indice) return "pasado";
      if (i === posicion.indice) return "actual";
      return i === posicion.indice + 1 ? "siguiente" : "futuro";
  }
}

function piePorPosicion(posicion: PosicionEnEscalera): string | null {
  switch (posicion.tipo) {
    case "no-disponible":
      return null;
    case "sin-sancion":
      return "Meta avisa las infracciones en el Business Support Home, en el administrador de WhatsApp y por el webhook account_update.";
    case "en-escalon":
      return "Qué llevó a la cuenta hasta acá lo detalla Meta en el Business Support Home.";
  }
}

function Escalon({
  escalon,
  lugar,
  desde,
  ultimo,
}: {
  escalon: EscalonSancion;
  lugar: Lugar;
  desde: string | null;
  ultimo: boolean;
}) {
  const esActual = lugar === "actual";
  const esSiguiente = lugar === "siguiente";
  const esReferencia = lugar === "referencia";
  const color = esActual ? "var(--color-caution)" : "var(--color-line-control)";

  return (
    <li className="flex gap-3">
      {/* El espinazo. Lleno hasta donde llegó, rayado de ahí en adelante. */}
      <div aria-hidden className="flex w-[17px] shrink-0 flex-col items-center">
        <span
          className={cn(
            "flex size-[17px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
            lugar === "futuro" && "border-line-card",
          )}
          style={
            lugar === "futuro"
              ? undefined
              : {
                  borderColor: color,
                  backgroundColor: esActual ? tinte(color, 22) : "transparent",
                  borderStyle: esSiguiente || esReferencia ? "dashed" : "solid",
                }
          }
        >
          {esActual ? (
            <Warning size={9} strokeWidth={3} style={{ color }} />
          ) : lugar === "pasado" ? (
            <span
              className="size-[5px] rounded-full"
              style={{ backgroundColor: "var(--color-line-control)" }}
            />
          ) : null}
        </span>
        {ultimo ? null : (
          <span
            className={cn("w-px flex-1", lugar === "pasado" ? "bg-line-control" : "bg-transparent")}
            style={
              lugar === "pasado"
                ? undefined
                : {
                    backgroundImage:
                      "repeating-linear-gradient(to bottom, var(--color-line-card) 0 3px, transparent 3px 6px)",
                  }
            }
          />
        )}
      </div>

      <div className={cn("flex min-w-0 flex-1 flex-col gap-1", ultimo ? "pb-0" : "pb-3.5")}>
        <div className="flex items-baseline gap-2.5">
          <h3
            className={cn(
              "min-w-0 flex-1 text-[11.5px] leading-snug",
              esActual
                ? "text-ink-primary font-[680]"
                : esSiguiente
                  ? "text-ink-secondary font-[650]"
                  : esReferencia
                    ? "text-ink-secondary font-medium"
                    : "text-ink-faint font-medium",
            )}
          >
            {escalon.nombre}
          </h3>
          {esActual && desde !== null ? (
            <span
              className="shrink-0 font-mono text-[10.5px] font-semibold tabular-nums"
              style={{ color }}
            >
              estás acá · {desde}
            </span>
          ) : (
            <span className="text-ink-ghost shrink-0 font-mono text-[10.5px] tabular-nums">
              {escalon.duracion}
            </span>
          )}
        </div>

        {/*
          Con una posición conocida, sólo el actual y el que sigue explican qué
          se pierde: escribir los cinco entierra la línea que importa. En modo
          referencia no hay "el que sigue", así que se explican todos.
        */}
        {esActual || esSiguiente || esReferencia ? (
          <p className="text-ink-faint text-[11px] leading-relaxed text-pretty">
            {esSiguiente ? <span className="text-ink-ghost">Si escala: </span> : null}
            {escalon.consecuencia}
          </p>
        ) : null}

        {(esActual || esReferencia) && escalon.apelacion !== null ? (
          <p className="text-ink-ghost font-mono text-[10px]">{escalon.apelacion}</p>
        ) : null}
      </div>
    </li>
  );
}
