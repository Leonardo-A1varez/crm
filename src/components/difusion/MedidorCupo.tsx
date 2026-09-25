"use client";

import { useState } from "react";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { cn } from "@/lib/utils";
import { anchoTramo, rielDeCupo } from "./cupo";
import { COLOR_CUPO, rayado, type TramoCupo } from "./paleta";
import { formatearEntero, formatearEscalon } from "./formato";
import { Cifra, Nota } from "./primitivas";
import type { Cupo, TandaReparto } from "./tipos";

const USO_PROPIO =
  "Meta no expone cuánto del cupo se usó: lo usado se cuenta con las plantillas que mandó este CRM en las últimas 24 h. Si otro sistema manda con el mismo número, acá no aparece.";

/**
 * El medidor de cupo, dibujado con lo que calculó el planificador.
 *
 * ── Un solo riel y no tres barras ─────────────────────────────────────────
 * Con una barra por magnitud, "esta difusión: 1.550 de 2.000" se dibuja al
 * 77 % y parece que entra cuando ya había 1.150 gastados. Acá hay un solo eje:
 * los tramos van uno atrás del otro sobre el mismo riel, en el orden en que se
 * consumen.
 *
 * ── Lo que no entra se sale de la caja ────────────────────────────────────
 * Cuando lo pedido no entra en la primera tanda, la escala crece más allá del
 * tope y el sobrante queda dibujado FUERA de la línea, rayado. Que no entre
 * deja de ser una frase y pasa a ser un hecho visual.
 *
 * Nada acá reparte: la primera tanda y las siguientes son las del
 * planificador (`rielDeCupo` sólo las suma). El riel es decorativo para el
 * lector de pantalla: las cifras están abajo como texto y el veredicto dice
 * con palabras si entra.
 */
export function MedidorCupo({ cupo, tandas }: { cupo: Cupo; tandas: readonly TandaReparto[] }) {
  const [resaltado, setResaltado] = useState<TramoCupo | null>(null);
  const riel = rielDeCupo(cupo, tandas);

  const encabezado = (
    <div className="flex items-baseline justify-between gap-3">
      <Eyebrow>Cupo de la ventana móvil de 24 h</Eyebrow>
      <span className="text-ink-faint font-mono text-[10.5px] tabular-nums">
        {cupo.estado === "ok" ? `tope ${formatearEscalon(cupo.tope)}` : "tope sin dato"}
      </span>
    </div>
  );

  if (cupo.estado === "sin-dato") {
    return (
      <div className="flex flex-col gap-3">
        {encabezado}
        <Nota>
          No se pudo leer el escalón de Meta, y sin él no se sabe cuántos entran por día:{" "}
          {cupo.motivo}
        </Nota>
      </div>
    );
  }

  if (riel === null) {
    return (
      <div className="flex flex-col gap-3">
        {encabezado}
        <Nota>
          Escalón ilimitado: Meta no pone tope diario de destinatarios. Las{" "}
          {formatearEntero(cupo.solicitado)} plantillas salen en la primera tanda.
        </Nota>
      </div>
    );
  }

  const textos: Record<TramoCupo, { etiqueta: string; glosa: string }> = {
    usado: { etiqueta: "Usado en las últimas 24 h", glosa: "contado con los envíos de este CRM" },
    reserva: { etiqueta: "Reservado para conversaciones vivas", glosa: "la difusión no lo toca" },
    difusion: { etiqueta: "Esta difusión, primera tanda", glosa: "lo que sale primero" },
    excedente: cupo.alcanza
      ? {
          etiqueta: "Tandas siguientes",
          glosa: `de a ${formatearEntero(cupo.porTanda)} cada 24 h`,
        }
      : { etiqueta: "No entra", glosa: "no queda cupo para plantillas" },
  };
  const excedente = riel.tramos.some((t) => t.clave === "excedente");

  return (
    <div className="flex flex-col gap-4">
      {encabezado}

      <div className="flex flex-col gap-2 pt-4" aria-hidden>
        <div className="relative">
          <div className="bg-surface-input flex h-4 overflow-hidden rounded-[5px]">
            {riel.tramos.map((t, i) => (
              <div
                key={t.clave}
                className={cn(
                  "h-full shrink-0 transition-[width,opacity] duration-500 ease-out",
                  i < riel.tramos.length - 1 && "border-surface-card border-r-2",
                )}
                style={{
                  width: `${anchoTramo(t.cantidad, riel.escala)}%`,
                  opacity: resaltado === null || resaltado === t.clave ? 1 : 0.28,
                  ...(t.clave === "excedente"
                    ? rayado(COLOR_CUPO.excedente)
                    : { backgroundColor: COLOR_CUPO[t.clave] }),
                }}
              />
            ))}
          </div>

          {/* Línea de tope: dónde termina lo que se puede mandar en 24 h. */}
          <div
            className="bg-ink-primary absolute -top-[5px] -bottom-[5px] w-[2px] rounded-full"
            style={{ left: `calc(${riel.posicionTope}% - 1px)` }}
          />
          <span
            className="text-ink-primary absolute -top-[22px] font-mono text-[9.5px] font-semibold tabular-nums"
            style={{
              left: `${riel.posicionTope}%`,
              transform: riel.posicionTope > 88 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >
            tope
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-[6px]">
        {riel.tramos.map((t) => (
          <li
            key={t.clave}
            onMouseEnter={() => setResaltado(t.clave)}
            onMouseLeave={() => setResaltado(null)}
            className={cn(
              "flex items-center gap-2.5 rounded-[7px] px-1.5 py-[3px] transition-colors duration-150",
              resaltado === t.clave && "bg-surface-hover",
            )}
          >
            <span
              aria-hidden
              className="ring-surface-card size-[9px] shrink-0 rounded-[3px] ring-2"
              style={
                t.clave === "excedente"
                  ? rayado(COLOR_CUPO.excedente)
                  : { backgroundColor: COLOR_CUPO[t.clave] }
              }
            />
            <span className="text-ink-secondary min-w-0 flex-1 text-[11.5px]">
              {textos[t.clave].etiqueta}
              <span className="text-ink-ghost"> · {textos[t.clave].glosa}</span>
            </span>
            <Cifra
              valor={formatearEntero(t.cantidad)}
              unidad="msj"
              tamano="sm"
              color={COLOR_CUPO[t.clave]}
              className="w-[86px]"
            />
          </li>
        ))}

        {riel.margen > 0 ? (
          <li className="flex items-center gap-2.5 px-1.5 py-[3px]">
            <span
              aria-hidden
              className="border-line-control size-[9px] shrink-0 rounded-[3px] border border-dashed"
            />
            <span className="text-ink-faint min-w-0 flex-1 text-[11.5px]">
              Margen que queda en la tanda
            </span>
            <Cifra
              valor={formatearEntero(riel.margen)}
              unidad="msj"
              tamano="sm"
              className="w-[86px]"
            />
          </li>
        ) : null}
      </ul>

      {excedente ? (
        <Nota>
          El riel se pasa de la línea de tope porque lo pedido no entra en una tanda. No se recorta
          el dibujo para que entre: eso es lo que hace que un exceso parezca que cabe.
        </Nota>
      ) : null}
      <Nota>{USO_PROPIO}</Nota>
    </div>
  );
}
