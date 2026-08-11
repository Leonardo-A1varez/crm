"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { Close, Handyman, HelpIcon, Psychology, Speed } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { etiquetaWorkflow, formatearPorcentaje, formatearUsd } from "@/lib/ui/metricas";
import type { AuditoriaTurnoInput } from "@/lib/validation/inbox.schema";
import type { UUID } from "@/types/entities";
import type {
  AuditoriaTurno as Auditoria,
  DecisionTurno,
  GastoTurno,
  HerramientaDelTurno,
  ResultadoAuditoria,
} from "@/types/inbox";

/**
 * "Por qué el agente respondió esto", colgado de la burbuja que lo respondió.
 *
 * Es un desplegable en el hilo y no un panel lateral por dos razones. La
 * pregunta se hace sobre **un** turno concreto, y la respuesta pierde sentido
 * separada de la burbuja que la motivó: un panel obligaría a mirar dos lugares
 * a la vez para saber de qué mensaje está hablando. Y el shell ya tiene tres
 * columnas con un mínimo de 1164px —lista, conversación, Twin—; un cuarto panel
 * o se come el Twin, que es lo que el vendedor mira mientras habla, o empuja el
 * mínimo a un ancho que no entra en las pantallas del piloto.
 *
 * El costo de traerlo se paga solo al desplegarlo, nunca al abrir la
 * conversación: son cuatro tablas por turno y un hilo tiene hasta 200 mensajes.
 */
export function AuditoriaTurno({
  mensajeId,
  onCargar,
}: {
  mensajeId: UUID;
  onCargar: (input: AuditoriaTurnoInput) => Promise<ResultadoAuditoria>;
}) {
  const [auditoria, setAuditoria] = useState<Auditoria | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [cargando, empezar] = useTransition();

  const alAbrir = () => {
    setAbierto(true);
    // Se pide una sola vez por turno: la auditoría es append-only y lo que se
    // muestra ya no cambia. Cerrar y volver a abrir no vuelve a la base.
    if (auditoria !== null || cargando) return;
    empezar(async () => {
      const resultado = await onCargar({ mensajeId });
      if (resultado.ok) setAuditoria(resultado.auditoria);
      else setError(resultado.error);
    });
  };

  if (!abierto) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={alAbrir}
          className="text-ink-fainter hover:text-ink-faint hover:bg-surface-elevated flex items-center gap-1 rounded-[7px] px-1.5 py-[2px] text-[10px] transition-colors"
        >
          <HelpIcon size={11} className="shrink-0" />
          ¿Por qué esta respuesta?
        </button>
      </div>
    );
  }

  return (
    <div className="flex justify-end">
      <section className="bg-surface-elevated border-line-card w-full max-w-[62%] rounded-[11px] border px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Eyebrow>Por qué esta respuesta</Eyebrow>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            aria-label="Cerrar el detalle del turno"
            className="text-ink-faint hover:text-ink-body hover:bg-surface-hover shrink-0 rounded-[6px] p-[3px] transition-colors"
          >
            <Close size={13} />
          </button>
        </div>

        {cargando ? <p className="text-ink-faint text-[11px]">Buscando el turno…</p> : null}
        {error ? <p className="text-danger text-[11px]">{error}</p> : null}
        {!cargando && !error && auditoria ? <Detalle auditoria={auditoria} /> : null}
      </section>
    </div>
  );
}

function Detalle({ auditoria }: { auditoria: Auditoria }) {
  if (auditoria.estado === "sin_registro") {
    return (
      <p className="text-ink-faint text-[11px] leading-relaxed">
        {auditoria.motivo === "sin_ancla"
          ? "No se puede saber: falta el vínculo entre esta respuesta y el mensaje que la disparó. Los turnos anteriores a que el pipeline lo empezara a guardar no lo tienen."
          : "No se midió. El turno existe, pero ninguna de las tablas de auditoría tiene una fila suya: pasa con los turnos anteriores a que esto se registrara."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Decision decision={auditoria.decision} />
      <Herramientas herramientas={auditoria.herramientas} />
      <Gasto gasto={auditoria.gasto} />
      <MonoMeta className="text-[9.5px]">
        turno abierto a las {format(auditoria.turnoAt, "HH:mm")}
      </MonoMeta>
    </div>
  );
}

/** Chip de quién resolvió: es el dato que se busca primero al abrir esto. */
function Decision({ decision }: { decision: DecisionTurno }) {
  if (decision.tipo === "sin_registro") {
    return (
      <p className="text-ink-faint text-[11px] leading-relaxed">
        No quedó registro de quién resolvió el turno: ni una regla ni una clasificación del modelo.
      </p>
    );
  }

  const esRegla = decision.tipo === "regla";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span
          className={
            esRegla
              ? "text-ok bg-ok/10 border-ok/28 inline-flex shrink-0 items-center gap-1 rounded-[7px] border px-[7px] py-[2px] text-[10px] font-semibold"
              : "text-brand-hover bg-brand/10 border-brand/28 inline-flex shrink-0 items-center gap-1 rounded-[7px] border px-[7px] py-[2px] text-[10px] font-semibold"
          }
        >
          {esRegla ? <Speed size={11} /> : <Psychology size={11} />}
          {esRegla ? "Regla IF/THEN" : "Modelo"}
        </span>
        <span className="text-ink-body min-w-0 flex-1 truncate text-[11.5px]">
          {esRegla
            ? decision.nombre
            : decision.intent === null
              ? "Sin intent reconocido"
              : decision.intent}
        </span>
      </div>
      <p className="text-ink-faint text-[10.5px]">
        {esRegla
          ? decision.intent === null
            ? "El intent que la disparó ya no está en el catálogo."
            : `Disparada por el intent “${decision.intent}”. Ninguna llamada al agente vendedor.`
          : `Ninguna regla cubría este turno${
              decision.intent === null
                ? ", y el clasificador no reconoció ningún intent activo"
                : ""
            }. Confianza de la clasificación: ${formatearPorcentaje(decision.confianza * 100)}.`}
      </p>
    </div>
  );
}

function Herramientas({ herramientas }: { herramientas: HerramientaDelTurno[] }) {
  return (
    <div className="border-line-card flex flex-col gap-1 border-t pt-2">
      <Eyebrow className="text-ink-ghost">Herramientas</Eyebrow>
      {herramientas.length === 0 ? (
        <p className="text-ink-faint text-[10.5px]">
          Sin llamadas a herramientas registradas en este turno.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {herramientas.map((h, i) => (
            // El índice alcanza como key: la lista es de solo lectura y llega
            // ya ordenada por hora, no se reordena ni se inserta en el medio.
            <li key={i} className="flex items-baseline gap-2">
              <Handyman size={11} className="text-ink-ghost shrink-0 translate-y-[1px]" />
              <span className="text-ink-dim min-w-0 flex-1 truncate font-mono text-[10.5px]">
                {h.nombre}
              </span>
              {h.error !== null ? (
                <span className="text-danger max-w-[45%] truncate text-[10.5px]">{h.error}</span>
              ) : null}
              <MonoMeta className="shrink-0 text-[10px]">
                {h.duracionMs === null ? "—" : `${h.duracionMs} ms`}
              </MonoMeta>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Gasto({ gasto }: { gasto: GastoTurno }) {
  if (gasto.estado === "sin_registro") {
    return (
      <div className="border-line-card flex flex-col gap-1 border-t pt-2">
        <Eyebrow className="text-ink-ghost">Costo</Eyebrow>
        <p className="text-ink-faint text-[10.5px]">
          Sin registro de gasto para este turno. No es cero: el clasificador corre en todos los
          turnos, así que un turno medido siempre deja al menos una llamada anotada.
        </p>
      </div>
    );
  }

  return (
    <div className="border-line-card flex flex-col gap-1 border-t pt-2">
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow className="text-ink-ghost">Costo</Eyebrow>
        <span className="text-ink-primary font-mono text-[12px] font-semibold tabular-nums">
          {formatearUsd(gasto.usd)}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {gasto.llamadas.map((l, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <span className="text-ink-dim min-w-0 flex-1 truncate text-[10.5px]">
              {etiquetaWorkflow(l.workflow)}
            </span>
            <MonoMeta className="shrink-0 text-[10px]">
              {l.modelo} · {l.inputTokens}/{l.outputTokens}
            </MonoMeta>
            <span className="text-ink-secondary w-16 shrink-0 text-right font-mono text-[10.5px] tabular-nums">
              {formatearUsd(l.usd)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
