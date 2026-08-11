"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Close, Done, Schedule } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { MAX_DIAS_RECORDATORIO, MAX_LARGO_NOTA_RECORDATORIO } from "@/lib/validation/inbox.schema";
import {
  campoFechaEnZona,
  campoHoraEnZona,
  ciudadDeZona,
  fechaLegibleEnZona,
  instanteDesdeCampos,
} from "@/lib/zona-horaria";
import type {
  CancelarRecordatorioInput,
  ProgramarRecordatorioInput,
  ReprogramarRecordatorioInput,
} from "@/lib/validation/inbox.schema";
import type { SessionRecordatorio, UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * Los plazos que se ofrecen de un click.
 *
 * "En 2 días" primero y por default porque es el que pidió el dueño con esas
 * palabras: es el plazo del lead que dijo "lo pienso". Los otros dos existen
 * para el que dijo "llamame mañana" y para el que se fue de viaje.
 *
 * **Se quedan aunque ahora exista el selector**: son el 90% de los casos, y
 * resolverlos en un click es lo que hace que la función se use. Un selector de
 * día y hora como única puerta convierte "volvé en 2 días" en cuatro
 * decisiones.
 *
 * Horas y no días de calendario: sumar 48 horas al momento del click cae a la
 * misma hora del día, que es cuando el vendedor está atendiendo. Un "pasado
 * mañana a las 00:00" pondría el chip arriba de la bandeja de madrugada y lo
 * dejaría envejecido antes de que alguien lo vea. Y al ser un desplazamiento
 * sobre "ahora", no dependen de ninguna zona horaria.
 */
const PLAZOS = [
  { label: "En 2 días", horas: 48 },
  { label: "Mañana", horas: 24 },
  { label: "En 1 semana", horas: 24 * 7 },
] as const;

/** La hora a la que se abre el selector cuando no hay una previa que copiar. */
const HORA_POR_DEFECTO = "10:00";

const UN_DIA_MS = 24 * 60 * 60 * 1000;

function enHoras(horas: number): Date {
  return new Date(Date.now() + horas * 60 * 60 * 1000);
}

/**
 * Fuera del componente para que el reloj no se lea durante el render: el
 * compilador de React trata `Date.now` como impuro ahí, y con razón —un valor
 * que cambia entre renders no puede participar de lo que se pinta—. Acá se
 * consulta una sola vez, en el click.
 */
function yaPaso(instante: Date): boolean {
  return instante.getTime() <= Date.now();
}

/**
 * El seguimiento de la conversación: "volver a contactar en 2 días".
 *
 * Es la respuesta al pedido del dueño —sin esto, el lead que dijo "lo pienso"
 * desaparece— y hace exactamente una cosa: cuando la fecha llega, la
 * conversación sube al grupo "Requieren tu atención" del Inbox con su chip.
 * **No le manda nada al cliente**, y el bloque lo dice con todas las letras: es
 * la pregunta que el dueño no contestó, y un saliente automático que aparece
 * sin que nadie lo haya pedido es de las cosas que salen caras.
 *
 * Uno solo por conversación. Con uno vivo el bloque muestra ese, ofrece moverle
 * la fecha y corregirle la nota —un paso, la misma cita— y ofrece cancelarlo.
 *
 * ## La zona horaria
 *
 * Todo lo que se ve y todo lo que se elige está en la hora del **negocio**
 * (`agente_config.horario_timezone`, la misma que decide el horario de
 * atención), nunca en la del navegador. Un vendedor que viaja, o el dueño
 * mirando el panel desde otro país, tienen que ver y programar el mismo reloj
 * que el que está en el local: si "martes a las 10" significara una hora
 * distinta según quién abre la ficha, el recordatorio dejaría de ser una cita.
 *
 * Los `<input type="date">` y `<input type="time">` nativos devuelven hora de
 * pared sin zona —justamente lo que hace falta— y `instanteDesdeCampos` la
 * ancla a la zona del negocio antes de mandarla al server en ISO con offset.
 */
export function RecordatorioSeguimiento({
  leadId,
  sessionId,
  recordatorio,
  timezone,
  onProgramar,
  onCancelar,
  onReprogramar,
}: {
  leadId: UUID;
  sessionId: UUID;
  /** El vivo de esta sesión, o `null` si no hay ninguno. */
  recordatorio: SessionRecordatorio | null;
  /** `agente_config.horario_timezone`. La resuelve el server. */
  timezone: string;
  onProgramar: (input: ProgramarRecordatorioInput) => Promise<ActionResult>;
  onCancelar: (input: CancelarRecordatorioInput) => Promise<ActionResult>;
  onReprogramar: (input: ReprogramarRecordatorioInput) => Promise<ActionResult>;
}) {
  const [nota, setNota] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [isPending, startTransition] = useTransition();

  const cerrarSelector = () => setAbierto(false);

  const programar = (recordarAt: Date) => {
    if (isPending) return;
    startTransition(async () => {
      const r = await onProgramar({
        leadId,
        sessionId,
        recordarAt: recordarAt.toISOString(),
        nota,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setNota("");
      cerrarSelector();
      toast.success("Recordatorio programado");
    });
  };

  const reprogramar = (recordatorioId: UUID, recordarAt: Date, nota: string | null) => {
    if (isPending) return;
    startTransition(async () => {
      const r = await onReprogramar({
        leadId,
        recordatorioId,
        recordarAt: recordarAt.toISOString(),
        nota,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      cerrarSelector();
      toast.success(nota === null ? "Recordatorio movido y nota borrada" : "Recordatorio movido");
    });
  };

  const cancelar = (recordatorioId: UUID) => {
    if (isPending) return;
    startTransition(async () => {
      const r = await onCancelar({ leadId, recordatorioId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Recordatorio cancelado");
    });
  };

  const encabezado = (
    <span className="text-ink-faint flex items-center gap-1.5">
      <Schedule size={12} className="shrink-0" />
      <Eyebrow>Seguimiento</Eyebrow>
    </span>
  );

  if (recordatorio) {
    const vencido = recordatorio.estado === "avisado";
    return (
      <div className="flex flex-col gap-3">
        {encabezado}

        <div className="border-info/24 bg-info/7 flex flex-col gap-2 rounded-[12px] border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-info text-[11.5px] font-semibold">
              {vencido ? "Toca volver a contactarlo" : "Volver a contactarlo"}
            </span>
            <MonoMeta className="shrink-0">
              <RelativeTime iso={recordatorio.recordar_at.toISOString()} />
            </MonoMeta>
          </div>

          {/* La fecha exacta y no solo el "en 2 días" de arriba: un relativo
              envejece mal —al día siguiente dice "hace 22 horas" y no dice a qué
              hora era— y es lo primero que se mira para decidir si mover la
              cita. Los dos conviven: el relativo para el vistazo, éste para
              confiar. */}
          <MonoMeta>{fechaLegibleEnZona(timezone, recordatorio.recordar_at)}</MonoMeta>

          {recordatorio.nota.trim() !== "" ? (
            <p className="text-ink-secondary text-[11.5px] break-words whitespace-pre-wrap">
              {recordatorio.nota}
            </p>
          ) : null}

          {/* Lo primero que alguien se pregunta al ver esto es si el cliente se
              entera. La respuesta va en el bloque, no en la documentación. */}
          <p className="text-ink-ghost text-[10px] leading-relaxed">
            Cuando llegue la fecha, la conversación sube en el Inbox. No se le manda ningún mensaje
            al cliente. Si el cliente escribe antes, el recordatorio se cancela solo.
          </p>

          {abierto ? (
            <SelectorFecha
              timezone={timezone}
              inicial={recordatorio.recordar_at}
              notaActual={recordatorio.nota}
              isPending={isPending}
              etiquetaConfirmar={vencido ? "Posponer" : "Mover"}
              onConfirmar={(fecha, notaNueva) => reprogramar(recordatorio.id, fecha, notaNueva)}
              onCerrar={cerrarSelector}
            />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setAbierto(true)}
                className="text-ink-secondary border-line-control hover:border-info/50 hover:text-info flex items-center gap-1.5 rounded-[7px] border px-2 py-[3px] text-[10.5px] font-semibold transition-colors disabled:opacity-50"
              >
                <Schedule size={11} className="shrink-0" />
                {vencido ? "Posponer" : "Cambiar fecha"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => cancelar(recordatorio.id)}
                className="text-ink-dim border-line-control hover:text-ink-secondary flex items-center gap-1.5 rounded-[7px] border px-2 py-[3px] text-[10.5px] font-semibold transition-colors disabled:opacity-50"
              >
                <Close size={11} className="shrink-0" />
                {isPending ? "Cancelando…" : "Cancelar recordatorio"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {encabezado}

      <div className="flex flex-col gap-2">
        <input
          value={nota}
          disabled={isPending}
          maxLength={MAX_LARGO_NOTA_RECORDATORIO}
          aria-label="Nota del recordatorio"
          placeholder="Por qué volver (opcional)"
          onChange={(e) => setNota(e.target.value)}
          className="text-ink-body border-line-input bg-surface-input w-full rounded-[8px] border px-2 py-1 text-[11.5px] outline-none"
        />

        <div className="flex flex-wrap gap-1.5">
          {PLAZOS.map(({ label, horas }) => (
            <button
              key={label}
              type="button"
              disabled={isPending}
              onClick={() => programar(enHoras(horas))}
              className="text-ink-secondary hover:border-info/50 hover:text-info border-line-control rounded-[7px] border px-2 py-[4px] text-[10.5px] font-semibold transition-colors disabled:opacity-50"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={isPending}
            aria-expanded={abierto}
            onClick={() => setAbierto((v) => !v)}
            className={`rounded-[7px] border px-2 py-[4px] text-[10.5px] font-semibold transition-colors disabled:opacity-50 ${
              abierto
                ? "border-info/50 text-info"
                : "text-ink-secondary hover:border-info/50 hover:text-info border-line-control"
            }`}
          >
            Otro día y hora
          </button>
        </div>

        {abierto ? (
          <SelectorFecha
            timezone={timezone}
            inicial={null}
            // Al crear, la nota se escribe en el campo de arriba: repetirla acá
            // adentro daría dos inputs para el mismo dato.
            notaActual={null}
            isPending={isPending}
            etiquetaConfirmar="Programar"
            onConfirmar={programar}
            onCerrar={cerrarSelector}
          />
        ) : null}

        <p className="text-ink-ghost text-[10px] leading-relaxed">
          Sube la conversación en el Inbox cuando llegue la fecha. No le escribe al cliente.
        </p>
      </div>
    </div>
  );
}

/**
 * Día y hora exactos, en la hora del negocio.
 *
 * Dos inputs nativos y no uno de `datetime-local`: el nativo combinado se
 * renderiza distinto en cada navegador y en varios obliga a tipear la fecha
 * entera. Separados, el calendario es el del sistema y la hora se corrige sin
 * volver a elegir el día — que es el gesto de "igual pero a las 9".
 *
 * ## Qué pasa con una hora que ya pasó
 *
 * Se rechaza; no se corre sola al futuro. El `min` del input impide elegir un
 * día anterior a hoy, así que el único caso que queda es "hoy más temprano", y
 * ahí el bloque lo dice antes de mandar nada. Mover en silencio la fecha que
 * alguien acaba de escribir sería inventar una decisión sobre lo único que este
 * control promete. El schema del server repite la guarda: el `min` de un input
 * no es una validación.
 *
 * ## Qué pasa fuera del horario de atención
 *
 * Se permite, a propósito y sin advertencia. El horario de `agente_config`
 * gobierna lo que el agente le contesta al **cliente**; esto es un aviso hacia
 * adentro que no le escribe a nadie. Un vendedor que arranca a las 7 y quiere
 * el recordatorio a las 7:30, o uno que lo pone un domingo para revisar el
 * lunes temprano, están haciendo exactamente lo correcto. Bloquearlo o alertarlo
 * sería aplicar la regla de una conversación a una nota personal.
 *
 * ## La nota, al mover
 *
 * Antes no se podía tocar: un typo en la nota obligaba a cancelar la cita y
 * crear otra. Ahora se edita en el mismo paso, con una asimetría deliberada —
 * **dejar el campo vacío NO borra la nota**. El campo se abre con el texto
 * actual adentro, y la forma más fácil de perderlo sería seleccionarlo, empezar
 * a escribir otra cosa y confirmar a mitad de camino. Borrar es un botón
 * aparte, con su propia confirmación visible, y es lo único que manda `null` al
 * server (ver `ReprogramarRecordatorioSchema`).
 */
function SelectorFecha({
  timezone,
  inicial,
  notaActual,
  isPending,
  etiquetaConfirmar,
  onConfirmar,
  onCerrar,
}: {
  timezone: string;
  /** La fecha actual del recordatorio cuando se está moviendo; `null` al crear. */
  inicial: Date | null;
  /**
   * La nota actual del recordatorio que se mueve. `null` al crear: ahí la nota
   * se escribe en el campo de afuera y este selector no la toca.
   */
  notaActual: string | null;
  isPending: boolean;
  etiquetaConfirmar: string;
  /** `nota`: texto nuevo, `""` para dejar la anterior como está, `null` para borrarla. */
  onConfirmar: (recordarAt: Date, nota: string | null) => void;
  onCerrar: () => void;
}) {
  const ahora = new Date();
  // Al mover, se abre con lo que ya tenía: casi siempre se corre un día o se
  // cambia la hora, no se elige de cero.
  const [fecha, setFecha] = useState(() =>
    campoFechaEnZona(timezone, inicial ?? new Date(ahora.getTime() + UN_DIA_MS)),
  );
  const [hora, setHora] = useState(() =>
    inicial ? campoHoraEnZona(timezone, inicial) : HORA_POR_DEFECTO,
  );
  const [nota, setNota] = useState(notaActual ?? "");
  const [borrarNota, setBorrarNota] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elegido = instanteDesdeCampos(timezone, fecha, hora);
  const editaNota = notaActual !== null;
  // Solo hay algo que conservar —y algo que ofrecerse a borrar— si había nota.
  const habiaNota = (notaActual ?? "").trim() !== "";

  const confirmar = () => {
    if (elegido === null) {
      setError("Elegí un día y una hora.");
      return;
    }
    if (yaPaso(elegido)) {
      setError("Esa hora ya pasó. Elegí uno más adelante.");
      return;
    }
    setError(null);
    // `""` cuando este selector no edita la nota: el server lo lee como "no la
    // toques", que es exactamente lo que corresponde al crear.
    onConfirmar(elegido, !editaNota ? "" : borrarNota ? null : nota);
  };

  return (
    <div className="border-line-control flex flex-col gap-2 rounded-[9px] border p-2">
      <div className="flex gap-1.5">
        <input
          type="date"
          value={fecha}
          disabled={isPending}
          aria-label="Día del recordatorio"
          min={campoFechaEnZona(timezone, ahora)}
          max={campoFechaEnZona(
            timezone,
            new Date(ahora.getTime() + MAX_DIAS_RECORDATORIO * UN_DIA_MS),
          )}
          onChange={(e) => {
            setFecha(e.target.value);
            setError(null);
          }}
          className="text-ink-body border-line-input bg-surface-input min-w-0 flex-1 rounded-[7px] border px-2 py-1 text-[11.5px] outline-none"
        />
        <input
          type="time"
          value={hora}
          disabled={isPending}
          aria-label="Hora del recordatorio"
          onChange={(e) => {
            setHora(e.target.value);
            setError(null);
          }}
          className="text-ink-body border-line-input bg-surface-input w-[86px] shrink-0 rounded-[7px] border px-2 py-1 text-[11.5px] outline-none"
        />
      </div>

      {/* De qué reloj estamos hablando. Sin esto, alguien que abre el panel
          desde otro huso no tiene forma de saber si "10:00" es la suya o la del
          local — y el error solo se descubre cuando el aviso salta tarde. */}
      <MonoMeta>
        {elegido ? fechaLegibleEnZona(timezone, elegido) : "—"} · hora de {ciudadDeZona(timezone)}
      </MonoMeta>

      {editaNota ? (
        <div className="flex flex-col gap-1">
          <input
            value={borrarNota ? "" : nota}
            disabled={isPending || borrarNota}
            maxLength={MAX_LARGO_NOTA_RECORDATORIO}
            aria-label="Nota del recordatorio"
            placeholder={habiaNota ? "Vacío deja la nota como está" : "Por qué volver (opcional)"}
            onChange={(e) => setNota(e.target.value)}
            className="text-ink-body border-line-input bg-surface-input w-full rounded-[8px] border px-2 py-1 text-[11.5px] outline-none disabled:opacity-50"
          />

          {borrarNota ? (
            <p className="text-warn flex flex-wrap items-baseline gap-1.5 text-[10px]">
              La nota se borra al confirmar.
              <button
                type="button"
                disabled={isPending}
                onClick={() => setBorrarNota(false)}
                className="text-ink-dim hover:text-ink-secondary underline underline-offset-2 disabled:opacity-50"
              >
                Dejarla
              </button>
            </p>
          ) : habiaNota ? (
            // El vacío no borra, y decirlo acá es lo que evita el descuido: sin
            // esta línea, alguien que limpia el campo cree que ya la borró.
            <p className="text-ink-ghost flex flex-wrap items-baseline gap-1.5 text-[10px]">
              Si lo dejás vacío, la nota queda como está.
              <button
                type="button"
                disabled={isPending}
                onClick={() => setBorrarNota(true)}
                className="text-ink-dim hover:text-warn underline underline-offset-2 disabled:opacity-50"
              >
                Borrar la nota
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {error !== null ? <p className="text-danger text-[10.5px]">{error}</p> : null}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={isPending}
          onClick={confirmar}
          className="text-info border-info/50 hover:bg-info/10 flex items-center gap-1.5 rounded-[7px] border px-2 py-[3px] text-[10.5px] font-semibold transition-colors disabled:opacity-50"
        >
          <Done size={11} className="shrink-0" />
          {isPending ? "Guardando…" : etiquetaConfirmar}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={onCerrar}
          className="text-ink-dim border-line-control hover:text-ink-secondary rounded-[7px] border px-2 py-[3px] text-[10.5px] font-semibold transition-colors disabled:opacity-50"
        >
          Volver
        </button>
      </div>
    </div>
  );
}
