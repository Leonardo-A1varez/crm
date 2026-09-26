"use client";

import { useState } from "react";
import { LockClock } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MOTIVO_EXCLUSION, esMotivoEximible } from "@/lib/difusion/modelo";
import { cn } from "@/lib/utils";
import { EXCLUSION, exclusionesVisibles } from "./exclusiones";
import { formatearResta } from "./formato";
import { CodigoMeta, Nota, Punto } from "./primitivas";
import type { Exclusion, MotivoExclusion } from "./tipos";

interface FilaExclusion {
  motivo: MotivoExclusion;
  /** `null` = todavía no hay una audiencia calculada. */
  cantidad: number | null;
  aplicada: boolean;
  eximible: boolean;
}

/** Las que se pueden levantar, en su orden de precedencia. Las decide el backend. */
const EXIMIBLES = MOTIVO_EXCLUSION.filter(esMotivoEximible);

/**
 * Las exclusiones que se aplican siempre.
 *
 * Son los diez motivos del planificador, con su vocabulario. Sólo dos se
 * pueden levantar —en negociación y tope de frecuencia— y son las únicas con
 * checkbox. El resto va con candado: un control deshabilitado invita a buscar
 * cómo habilitarlo, y acá no hay cómo, porque protegen al número o a una
 * conversación en curso.
 *
 * Lo marcado en las eximibles es lo que eligió la persona (`aplicadas`), no lo
 * que dice el último cálculo: el cálculo llega un instante después, y un
 * checkbox que no responde al tocarlo parece roto.
 *
 * Destildar una eximible pide confirmación explícita, con la consecuencia a la
 * vista, y el servidor la deja en la auditoría al guardar el borrador. Volver
 * a excluir no pregunta: es la opción segura.
 */
export function ExclusionesAudiencia({
  exclusiones,
  aplicadas,
  onAlternar,
}: {
  /** Del último cálculo; `null` mientras la audiencia no esté completa. */
  exclusiones: readonly Exclusion[] | null;
  aplicadas: Partial<Record<MotivoExclusion, boolean>>;
  onAlternar: (motivo: MotivoExclusion, aplicada: boolean) => void;
}) {
  const filas: FilaExclusion[] =
    exclusiones === null
      ? EXIMIBLES.map((motivo) => ({
          motivo,
          cantidad: null,
          aplicada: aplicadas[motivo] ?? true,
          eximible: true,
        }))
      : exclusionesVisibles(exclusiones).map((e) =>
          e.eximible ? { ...e, aplicada: aplicadas[e.motivo] ?? e.aplicada } : e,
        );
  const ocultas = exclusiones === null ? 0 : exclusiones.length - filas.length;
  const [pendiente, setPendiente] = useState<MotivoExclusion | null>(null);
  const aConfirmar = pendiente === null ? null : EXCLUSION[pendiente];
  const cantidadPendiente = filas.find((f) => f.motivo === pendiente)?.cantidad ?? null;

  return (
    <div className="flex flex-col gap-2">
      <ul className="border-line-card bg-surface-card flex flex-col rounded-[11px] border">
        {filas.map((e, i) => {
          const d = EXCLUSION[e.motivo];
          return (
            <li
              key={e.motivo}
              className={cn(
                "flex min-h-[40px] items-center gap-3 px-3 py-2",
                i > 0 && "border-line-row border-t",
              )}
            >
              {e.eximible ? (
                <input
                  type="checkbox"
                  checked={e.aplicada}
                  onChange={(ev) =>
                    ev.target.checked ? onAlternar(e.motivo, true) : setPendiente(e.motivo)
                  }
                  aria-label={`Excluir: ${d.etiqueta}`}
                  className="border-line-control checked:bg-ink-primary checked:border-ink-primary focus-visible:ring-ring/50 size-[18px] shrink-0 appearance-none rounded-[5px] border transition-colors duration-150 focus-visible:ring-3 focus-visible:outline-none"
                />
              ) : (
                <span
                  className="text-ink-faint inline-flex size-[18px] shrink-0 items-center justify-center"
                  title="No se puede desmarcar"
                >
                  <LockClock size={13} aria-hidden />
                  <span className="sr-only">Obligatoria, no se puede desmarcar.</span>
                </span>
              )}

              <Punto color={d.color} />

              <span className="min-w-0 flex-1">
                <span className="text-ink-secondary block text-[11.5px] font-medium">
                  {d.etiqueta}
                </span>
                <span className="text-ink-ghost block text-[10.5px] text-pretty">
                  {d.consecuencia}
                </span>
              </span>

              {d.codigo ? <CodigoMeta codigo={d.codigo} color={d.color} /> : null}

              <span
                className={cn(
                  "w-[62px] shrink-0 text-right font-mono text-[12px] font-medium tabular-nums",
                  e.cantidad === null
                    ? "text-ink-ghost"
                    : e.aplicada
                      ? "text-ink-primary"
                      : "text-ink-ghost line-through",
                )}
              >
                {e.cantidad === null ? (
                  <>
                    <span aria-hidden>—</span>
                    <span className="sr-only">sin calcular</span>
                  </>
                ) : (
                  <>
                    {formatearResta(e.cantidad)}
                    {e.aplicada ? null : <span className="sr-only"> (no se aplica)</span>}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <Dialog open={pendiente !== null} onOpenChange={(abierto) => !abierto && setPendiente(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Mandarles igual?</DialogTitle>
            <DialogDescription>
              {aConfirmar ? (
                <>
                  Vas a dejar de excluir «{aConfirmar.etiqueta}»
                  {cantidadPendiente !== null && cantidadPendiente > 0
                    ? ` (${cantidadPendiente} en esta audiencia)`
                    : ""}
                  : {aConfirmar.consecuencia}. Queda registrado en la auditoría con tu usuario.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendiente(null)}>
              Seguir excluyéndolos
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendiente !== null) onAlternar(pendiente, false);
                setPendiente(null);
              }}
            >
              Mandarles igual
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Nota>
        Las que llevan candado no se desmarcan. En negociación y tope de frecuencia sí, con
        confirmación, y lo que elijas queda en la difusión y en la auditoría.
        {exclusiones === null
          ? " Las demás se calculan cuando la audiencia esté completa."
          : ocultas > 0
            ? ` ${ocultas === 1 ? "La otra no excluye" : `Las otras ${ocultas} no excluyen`} a nadie de esta audiencia y no se listan.`
            : ""}
      </Nota>
    </div>
  );
}
