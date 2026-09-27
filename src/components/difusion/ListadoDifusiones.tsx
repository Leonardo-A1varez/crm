"use client";

import Link from "next/link";
import { BadgeSalud } from "@/components/ajustes/BadgeSalud";
import { DESCRIPTOR_CALIDAD, DESCRIPTOR_ENVIO } from "@/components/ajustes/descriptores";
import { Add, HelpIcon, Warning } from "@/components/icons";
import { EmptyState } from "@/components/shared/EmptyState";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { anchoTramo, rielDeCupo, type RielCupo } from "./cupo";
import { ESTADO_DIFUSION } from "./estado-difusion";
import { COLOR_CUPO, rayado, tinte } from "./paleta";
import { formatearEntero, formatearEscalon, formatearUsd } from "./formato";
import { Cifra, Nota, Panel, Punto } from "./primitivas";
import type { AvisoSancion, Cupo, Dato, ListadoVista, SaludNumero } from "./tipos";
import type { EnvioSegunMeta } from "@/components/ajustes/tipos";
import type { ReactNode } from "react";

/**
 * Encabezado y filas comparten la plantilla de columnas: si se desincronizan,
 * la desalineación es invisible leyendo el diff.
 */
const FILA =
  "grid grid-cols-[minmax(0,1fr)_150px_78px_78px_78px_78px_92px_112px] items-center gap-3 px-3.5";

const SIN_RESPUESTAS = "El listado no suma las respuestas: se ven en el envío de cada difusión.";
const SIN_COSTO = "Todavía no se registra lo que cobró Meta por cada difusión.";

function textoEnvio(envio: EnvioSegunMeta): string {
  const { label } = DESCRIPTOR_ENVIO[envio.estado];
  switch (envio.estado) {
    case "disponible":
      return `${label}, según Meta.`;
    case "limitado":
    case "bloqueado":
      return `${label}: ${envio.detalle}`;
    case "sin-dato":
      return `Estado de envío sin dato: ${envio.motivo}`;
  }
}

/**
 * La sanción de Meta, arriba de todo: es lo único de esta pantalla que puede
 * frenar una difusión entera antes de armarla.
 *
 * Mismo criterio que la escalera de Ajustes: el color se gasta sólo en "estás
 * acá". Si `health_status` dice que la cuenta puede enviar, el escalón es el
 * último aviso guardado y no el estado de hoy: va en gris, con la explicación,
 * igual que el recuadro "no coincide" de Ajustes.
 */
function AvisoSancionMeta({ aviso }: { aviso: AvisoSancion }) {
  const color = aviso.historico ? "var(--color-ink-faint)" : "var(--color-caution)";
  const marca = aviso.historico ? "último aviso" : "estás acá";
  return (
    <section
      aria-label="Sanción de Meta"
      className="flex items-start gap-3 rounded-[11px] border px-4 py-3"
      style={
        aviso.historico
          ? {
              borderColor: "var(--color-line-card)",
              backgroundColor: "var(--color-surface-input)",
            }
          : {
              borderColor: tinte("var(--color-caution)", 40),
              backgroundColor: tinte("var(--color-caution)", 8),
            }
      }
    >
      {aviso.historico ? (
        <HelpIcon
          size={15}
          strokeWidth={2.25}
          className="text-ink-faint mt-px shrink-0"
          aria-hidden
        />
      ) : (
        <Warning size={15} className="text-caution mt-px shrink-0" aria-hidden />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="text-ink-primary text-[12px] leading-snug font-[650] text-balance">
            Escalera de sanciones de Meta: {aviso.escalon}
          </h2>
          <span className="font-mono text-[10.5px] font-semibold tabular-nums" style={{ color }}>
            {aviso.desde === null ? marca : `${marca} · ${aviso.desde}`}
          </span>
        </div>
        <p className="text-ink-secondary text-[11px] leading-relaxed text-pretty">
          {aviso.explicacion ?? aviso.consecuencia}
        </p>
      </div>
      <Link
        href="/ajustes?tab=salud"
        className="text-ink-secondary hover:text-ink-primary shrink-0 self-center rounded-[6px] px-2 py-1.5 text-[11px] font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-brand)] focus-visible:outline-solid"
      >
        Ver en Ajustes
      </Link>
    </section>
  );
}

function subtitulo(listado: Dato<ListadoVista>): ReactNode {
  if (listado.estado !== "ok") return "No se pudieron leer las difusiones";
  const { difusiones, hayMas, destinatarios30d, destinatarios30dCompleto } = listado.valor;
  const n = difusiones.length;
  return (
    <>
      {hayMas
        ? `las ${formatearEntero(n)} más recientes`
        : `${formatearEntero(n)} ${n === 1 ? "campaña" : "campañas"}`}{" "}
      · {destinatarios30dCompleto ? "" : "más de "}
      <span className="font-mono tabular-nums">{formatearEntero(destinatarios30d)}</span>{" "}
      destinatarios en los últimos 30 días
    </>
  );
}

/**
 * Listado de difusiones. Arriba, cuatro datos que deciden si hoy se puede
 * mandar algo; abajo, las campañas con lo que salió de verdad.
 *
 * Las cuatro tarjetas son las cuatro cosas que pueden impedir un envío (cupo,
 * calidad del número, gente que se dio de baja y plantillas pausadas). Todas
 * salen de Meta o de la base; lo que no se pudo leer lo dice con su motivo.
 */
export function ListadoDifusiones({
  listado,
  cupo,
  salud,
  puedeCrear,
  onNueva,
  onAbrir,
}: {
  listado: Dato<ListadoVista>;
  cupo: Cupo;
  salud: SaludNumero;
  /** Armar una difusión es de admin: a un vendedor no se le ofrece. */
  puedeCrear: boolean;
  onNueva: () => void;
  onAbrir: (id: string) => void;
}) {
  const riel = rielDeCupo(cupo, []);
  const pausadas = salud.plantillasPausadas;
  const hayPausadas = pausadas.estado === "ok" && pausadas.valor.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Difusión"
        subtitle={subtitulo(listado)}
        actions={
          puedeCrear ? (
            <Button onClick={onNueva}>
              <Add data-icon="inline-start" />
              Nueva difusión
            </Button>
          ) : null
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-5">
        {salud.sancion ? <AvisoSancionMeta aviso={salud.sancion} /> : null}
        <div className="grid grid-cols-4 gap-3">
          <Panel titulo="Cupo de la ventana móvil">
            {cupo.estado === "sin-dato" ? (
              <Nota>{cupo.motivo}</Nota>
            ) : cupo.tope === "ilimitado" || riel === null ? (
              <div className="flex flex-col gap-2.5">
                <Cifra valor="ilimitado" tamano="lg" className="justify-start" />
                <Nota>Meta no pone tope diario de destinatarios en este escalón.</Nota>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-baseline gap-1.5">
                  <Cifra valor={formatearEntero(cupo.usado24h)} tamano="lg" />
                  <span className="text-ink-faint font-mono text-[11.5px] tabular-nums">
                    / {formatearEscalon(cupo.tope)}
                  </span>
                </div>
                <RielDelListado riel={riel} />
                <Nota>
                  {formatearEntero(cupo.porTanda)} libres para plantillas en las próximas 24 h. El
                  uso se cuenta con los envíos de este CRM: Meta no lo expone.
                </Nota>
              </div>
            )}
          </Panel>

          <Panel titulo="Calidad del número">
            <div className="flex flex-col gap-2.5">
              <BadgeSalud
                descriptor={
                  DESCRIPTOR_CALIDAD[
                    salud.calidad.estado === "ok" ? salud.calidad.valor.calidad : "sin-datos"
                  ]
                }
              />
              {salud.calidad.estado === "sin-dato" ? <Nota>{salud.calidad.motivo}</Nota> : null}
              <Nota>{textoEnvio(salud.envio)}</Nota>
            </div>
          </Panel>

          <Panel titulo="Suprimidos (lista propia)">
            <div className="flex flex-col gap-2.5">
              {listado.estado === "ok" ? (
                <Cifra
                  valor={formatearEntero(listado.valor.suprimidos)}
                  unidad="números"
                  tamano="lg"
                  className="justify-start"
                />
              ) : (
                <Cifra valor="—" tamano="lg" className="justify-start" />
              )}
              <Nota>Irreversible por escritura automática.</Nota>
            </div>
          </Panel>

          <Panel
            titulo="Requiere acción manual"
            acento={hayPausadas ? tinte("var(--color-caution)", 40) : undefined}
          >
            {pausadas.estado === "sin-dato" ? (
              <Nota>{pausadas.motivo}</Nota>
            ) : pausadas.valor.length === 0 ? (
              <Nota>Ninguna plantilla pausada.</Nota>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Warning size={14} className="text-caution shrink-0" aria-hidden />
                  <span className="text-ink-primary truncate font-mono text-[12px] font-medium">
                    {pausadas.valor[0]?.nombre}
                  </span>
                  {pausadas.valor.length > 1 ? (
                    <span className="text-ink-faint shrink-0 text-[11px]">
                      y {pausadas.valor.length - 1} más
                    </span>
                  ) : null}
                </div>
                <Nota>
                  Pausada por Meta. La API no dice si vuelve sola o hay que despausarla a mano.
                </Nota>
              </div>
            )}
          </Panel>
        </div>

        {listado.estado !== "ok" ? (
          <Panel>
            <EmptyState title="No se pudieron leer las difusiones" description={listado.motivo} />
          </Panel>
        ) : listado.valor.difusiones.length === 0 ? (
          <Panel>
            <EmptyState
              title="Todavía no hay difusiones"
              description="Una difusión manda una plantilla aprobada a un recorte de leads. Antes de programarla, el pre-vuelo muestra la lista exacta, el cupo y las tandas."
              action={
                puedeCrear ? (
                  <Button onClick={onNueva} size="sm">
                    Nueva difusión
                  </Button>
                ) : undefined
              }
            />
          </Panel>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className={cn(FILA, "pb-1")} aria-hidden>
              <Eyebrow>campaña</Eyebrow>
              <Eyebrow>plantilla</Eyebrow>
              <Eyebrow className="text-right">dest.</Eyebrow>
              <Eyebrow className="text-right">entreg.</Eyebrow>
              <Eyebrow className="text-right">leídos</Eyebrow>
              <span title={SIN_RESPUESTAS}>
                <Eyebrow className="text-right">resp.</Eyebrow>
              </span>
              <span title={SIN_COSTO}>
                <Eyebrow className="text-right">costo</Eyebrow>
              </span>
              <Eyebrow>estado</Eyebrow>
            </div>

            <ul aria-label="Difusiones" className="flex flex-col gap-1.5">
              {listado.valor.difusiones.map((d) => {
                const estado = ESTADO_DIFUSION[d.estado];
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => onAbrir(d.id)}
                      className={cn(
                        FILA,
                        "border-line-card bg-surface-card hover:border-line-control focus-visible:ring-ring/50 min-h-[46px] w-full rounded-[11px] border py-2.5 text-left transition-colors duration-150 focus-visible:ring-3 focus-visible:outline-none",
                      )}
                    >
                      <span className="text-ink-primary truncate text-[12.5px] font-[650]">
                        {d.nombre}
                        <span className="text-ink-ghost block truncate text-[10.5px] font-normal">
                          {d.cuando}
                        </span>
                      </span>
                      <span className="text-ink-faint truncate font-mono text-[11px]">
                        {d.plantilla ?? "sin plantilla"}
                      </span>
                      <Celda valor={formatearEntero(d.destinatarios)} lectura="destinatarios" />
                      <Celda
                        valor={formatearEntero(d.entregados)}
                        lectura="entregados"
                        color="var(--color-ok)"
                      />
                      <Celda
                        valor={formatearEntero(d.leidos)}
                        lectura="leídos"
                        color="var(--color-info)"
                      />
                      {d.respondieron === null ? (
                        <SinDato titulo={SIN_RESPUESTAS} />
                      ) : (
                        <Celda valor={formatearEntero(d.respondieron)} lectura="respondieron" />
                      )}
                      {d.costoUsd === null ? (
                        <SinDato titulo={SIN_COSTO} />
                      ) : (
                        <Celda valor={formatearUsd(d.costoUsd)} lectura="de costo" />
                      )}
                      <span className="flex items-center gap-1.5">
                        <Punto color={estado.color} latiendo={d.estado === "enviando"} />
                        <span
                          className="truncate text-[11px] font-semibold"
                          style={{ color: estado.color }}
                        >
                          {estado.etiqueta}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <Nota>Las respuestas entran a la Bandeja como cualquier otro mensaje.</Nota>
      </div>
    </div>
  );
}

/** Una cifra de la fila, con la palabra que la nombra para quien la escucha. */
function Celda({ valor, lectura, color }: { valor: string; lectura: string; color?: string }) {
  return (
    <span className="w-full text-right">
      <Cifra valor={valor} tamano="sm" color={color} className="w-full justify-end" />
      <span className="sr-only"> {lectura}</span>
    </span>
  );
}

function SinDato({ titulo }: { titulo: string }) {
  return (
    <span className="text-ink-ghost w-full text-right font-mono text-[11.5px]" title={titulo}>
      <span aria-hidden>—</span>
      <span className="sr-only">{titulo}</span>
    </span>
  );
}

/**
 * El riel chico de la tarjeta de cupo. Sin leyenda, un tramo ámbar del 15 %
 * pegado al uso se leía como "15 % usado" cuando se había usado el 0,25 %.
 *
 *   - Lo usado arranca a la izquierda: es lo único que se consumió.
 *   - Lo reservado se ancla a la DERECHA, contra el tope, y va rayado: es cupo
 *     apartado, no gastado. El rayado es la codificación secundaria; el color
 *     es el del medidor del asistente, para que se reconozca de una pantalla
 *     a la otra.
 *   - Debajo, una leyenda con las dos cifras: dos tramos sin nombre no se leen.
 */
function RielDelListado({ riel }: { riel: RielCupo }) {
  const usado = riel.tramos.find((t) => t.clave === "usado")?.cantidad ?? 0;
  const reserva = riel.tramos.find((t) => t.clave === "reserva")?.cantidad ?? 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="bg-surface-input relative h-[6px] overflow-hidden rounded-full" aria-hidden>
        {usado > 0 ? (
          <div
            className="absolute inset-y-0 left-0 min-w-[2px] rounded-full"
            style={{
              width: `${anchoTramo(usado, riel.escala)}%`,
              backgroundColor: COLOR_CUPO.usado,
            }}
          />
        ) : null}
        {reserva > 0 ? (
          <div
            className="border-surface-card absolute inset-y-0 right-0 border-l-2"
            style={{
              width: `${anchoTramo(reserva, riel.escala)}%`,
              ...rayado(COLOR_CUPO.reserva),
            }}
          />
        ) : null}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
        <li className="text-ink-faint flex items-center gap-1.5 text-[10.5px]">
          <span
            aria-hidden
            className="size-[8px] shrink-0 rounded-[2px]"
            style={{ backgroundColor: COLOR_CUPO.usado }}
          />
          usado
          <span className="text-ink-secondary font-mono tabular-nums">
            {formatearEntero(usado)}
          </span>
        </li>
        {reserva > 0 ? (
          <li className="text-ink-faint flex items-center gap-1.5 text-[10.5px]">
            <span
              aria-hidden
              className="size-[8px] shrink-0 rounded-[2px]"
              style={rayado(COLOR_CUPO.reserva)}
            />
            reservado para conversaciones
            <span className="text-ink-secondary font-mono tabular-nums">
              {formatearEntero(reserva)}
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
