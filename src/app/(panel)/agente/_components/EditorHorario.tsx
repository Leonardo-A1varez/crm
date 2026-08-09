"use client";

import { useState } from "react";
import { AltRoute, Close } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { esTimezoneValida } from "@/lib/agente/horario";
import { cn } from "@/lib/utils";
import { DIAS_SEMANA, type DiaSemana, type Horario, type RangoHorario } from "@/types/agente";

const DIA_LABEL: Record<DiaSemana, string> = {
  lun: "Lunes",
  mar: "Martes",
  mie: "Miércoles",
  jue: "Jueves",
  vie: "Viernes",
  sab: "Sábado",
  dom: "Domingo",
};

// Día siguiente en la semana, cíclico (dom -> lun): el día al que se traslada
// la cola de un rango que cruza medianoche.
const DIA_SIGUIENTE: Record<DiaSemana, DiaSemana> = {
  lun: "mar",
  mar: "mie",
  mie: "jue",
  jue: "vie",
  vie: "sab",
  sab: "dom",
  dom: "lun",
};

interface Borrador {
  desde: string;
  hasta: string;
}

interface Cruce {
  dia: DiaSemana;
  desde: string;
  hasta: string;
}

function borradorInicial(): Record<DiaSemana, Borrador> {
  const out = {} as Record<DiaSemana, Borrador>;
  for (const dia of DIAS_SEMANA) out[dia] = { desde: "", hasta: "" };
  return out;
}

/**
 * Grilla semanal de rangos + timezone. El caso que justifica este archivo
 * aparte: `normalizarRangos` (lib/agente/horario.ts) descarta un rango que
 * cruza medianoche (22:00-02:00) por "invertido" — el modelo de datos es
 * rangos dentro de un día. Guardar ese rango tal cual lo haría desaparecer en
 * silencio y el negocio nocturno queda cerrado sin entender por qué. Acá se
 * detecta el cruce ANTES de que llegue al server y se ofrece partirlo en los
 * dos días que sí representan el mismo horario sin huecos.
 */
export function EditorHorario({
  horario,
  timezone,
  onChange,
  disabled,
}: {
  horario: Horario;
  timezone: string;
  onChange: (patch: { horario?: Horario; horario_timezone?: string }) => void;
  disabled?: boolean;
}) {
  const [borrador, setBorrador] = useState<Record<DiaSemana, Borrador>>(borradorInicial);
  const [cruce, setCruce] = useState<Cruce | null>(null);

  function quitarRango(dia: DiaSemana, idx: number) {
    onChange({ horario: { ...horario, [dia]: horario[dia].filter((_, i) => i !== idx) } });
  }

  function agregarRango(dia: DiaSemana) {
    const { desde, hasta } = borrador[dia];
    if (desde === "" || hasta === "" || desde === hasta) return;
    if (hasta < desde) {
      setCruce({ dia, desde, hasta });
      return;
    }
    const rango: RangoHorario = { desde, hasta };
    onChange({ horario: { ...horario, [dia]: [...horario[dia], rango] } });
    setBorrador((b) => ({ ...b, [dia]: { desde: "", hasta: "" } }));
  }

  function confirmarCruce() {
    if (!cruce) return;
    const siguiente = DIA_SIGUIENTE[cruce.dia];
    onChange({
      horario: {
        ...horario,
        [cruce.dia]: [...horario[cruce.dia], { desde: cruce.desde, hasta: "23:59" }],
        [siguiente]: [...horario[siguiente], { desde: "00:00", hasta: cruce.hasta }],
      },
    });
    setBorrador((b) => ({ ...b, [cruce.dia]: { desde: "", hasta: "" } }));
    setCruce(null);
  }

  const tzValida = esTimezoneValida(timezone);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Eyebrow>Timezone</Eyebrow>
        <input
          type="text"
          value={timezone}
          onChange={(e) => onChange({ horario_timezone: e.target.value })}
          disabled={disabled}
          placeholder="America/Argentina/Buenos_Aires"
          className={cn(
            "bg-surface-input border-line-input text-ink-body mt-2 w-full rounded-[10px] border p-2 font-mono text-[11.5px]",
            !tzValida && "border-danger",
          )}
        />
        {!tzValida ? (
          <p className="text-danger mt-1 text-[10.5px]">
            No es una timezone IANA reconocida (ej: America/Sao_Paulo).
          </p>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2.5">
        {DIAS_SEMANA.map((dia) => (
          <li key={dia} className="flex items-start gap-3">
            <span className="text-ink-secondary w-[72px] shrink-0 pt-1.5 text-[11.5px] font-medium">
              {DIA_LABEL[dia]}
            </span>
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {horario[dia].length === 0 ? (
                <span className="text-ink-ghost text-[10.5px] italic">Cerrado</span>
              ) : null}
              {horario[dia].map((r, i) => (
                <span
                  key={`${r.desde}-${r.hasta}-${i}`}
                  className="bg-surface-elevated border-line-card text-ink-body flex items-center gap-1 rounded-full border py-1 pr-1.5 pl-2.5 font-mono text-[10.5px]"
                >
                  {r.desde}–{r.hasta}
                  <button
                    type="button"
                    aria-label={`Quitar rango ${r.desde} a ${r.hasta} de ${DIA_LABEL[dia]}`}
                    disabled={disabled}
                    onClick={() => quitarRango(dia, i)}
                    className="text-ink-ghost hover:text-ink-primary"
                  >
                    <Close size={11} />
                  </button>
                </span>
              ))}
              <input
                type="time"
                value={borrador[dia].desde}
                disabled={disabled}
                onChange={(e) =>
                  setBorrador((b) => ({ ...b, [dia]: { ...b[dia], desde: e.target.value } }))
                }
                className="bg-surface-input border-line-input text-ink-body w-[84px] rounded-[8px] border px-1.5 py-1 font-mono text-[10.5px]"
              />
              <span className="text-ink-ghost text-[10.5px]">a</span>
              <input
                type="time"
                value={borrador[dia].hasta}
                disabled={disabled}
                onChange={(e) =>
                  setBorrador((b) => ({ ...b, [dia]: { ...b[dia], hasta: e.target.value } }))
                }
                className="bg-surface-input border-line-input text-ink-body w-[84px] rounded-[8px] border px-1.5 py-1 font-mono text-[10.5px]"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => agregarRango(dia)}
                className="text-ink-dim hover:text-ink-primary text-[10.5px] underline"
              >
                Agregar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {cruce ? (
        <div className="border-danger bg-danger/10 rounded-[12px] border p-3">
          <p className="text-danger flex items-start gap-1.5 text-[11px] font-semibold">
            <AltRoute size={13} className="mt-0.5 shrink-0" />
            Este rango cruza la medianoche
          </p>
          <p className="text-ink-secondary mt-1 text-[10.5px]">
            {DIA_LABEL[cruce.dia]} {cruce.desde}–{cruce.hasta} no se puede guardar así: el servidor
            lo descarta por invertido y desaparecería en silencio. Se puede partir en{" "}
            {DIA_LABEL[cruce.dia]} {cruce.desde}–23:59 y {DIA_LABEL[DIA_SIGUIENTE[cruce.dia]]}{" "}
            00:00–{cruce.hasta}, sin huecos.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setCruce(null)}
              className="text-ink-dim hover:text-ink-primary text-[11px] underline"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmarCruce}
              className="bg-brand text-brand-ink ml-auto rounded-[7px] px-3 py-1.5 text-[11px] font-semibold"
            >
              Partir en los dos días
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
