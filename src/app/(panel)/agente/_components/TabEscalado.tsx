"use client";

import { Bolt, HelpIcon, PanTool, Schedule, Sell } from "@/components/icons";
import { MonoMeta } from "@/components/shared/MonoMeta";
import {
  COTIZACION_MAX,
  COTIZACION_MIN,
  COTIZACION_PASO,
  UMBRAL_INTENTS_MAX,
  UMBRAL_INTENTS_MIN,
} from "@/lib/agente/escalado";
import { PalabrasEscalado } from "./PalabrasEscalado";
import { Stepper } from "./Stepper";
import { SwitchConsola } from "./SwitchConsola";
import { TarjetaConsola } from "./TarjetaConsola";
import type { AgenteConfigValores } from "@/types/agente";
import type { ComponentType, CSSProperties, ReactNode } from "react";

/**
 * Cotización por defecto al encender la condición. El handoff dibuja $500k en
 * el prototipo; acá es el valor con el que arranca el switch, no un dato
 * mostrado sin poder cambiarse.
 */
const COTIZACION_INICIAL = 500_000;

function formatPesos(monto: number): string {
  return `$${(monto / 1000).toLocaleString("es-AR", { maximumFractionDigits: 0 })}k`;
}

/** Fila de condición del §4.2: ícono en su color, label, subtítulo y control. */
function FilaCondicion({
  label,
  detalle,
  Icon,
  color,
  control,
  nota,
}: {
  label: string;
  detalle: string;
  Icon: ComponentType<{ className?: string; size?: number; style?: CSSProperties }>;
  color: string;
  control?: ReactNode;
  nota?: ReactNode;
}) {
  return (
    <li className="border-line-layout border-b py-3 last:border-0">
      <div className="flex items-start gap-2.5">
        <Icon size={18} className="mt-px shrink-0" style={{ color }} />
        <div className="min-w-0 flex-1">
          <span className="text-ink-primary text-[12px] font-semibold">{label}</span>
          <p className="text-ink-dim mt-0.5 text-[10.5px]">{detalle}</p>
          {nota !== undefined ? <p className="text-ink-faint mt-1 text-[10.5px]">{nota}</p> : null}
        </div>
        {control !== undefined ? (
          <div className="flex shrink-0 items-center gap-2">{control}</div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * §4.2 — Escalado.
 *
 * Las condiciones que la config puede cambiar llevan su control real; las que
 * el sistema todavía no sabe evaluar se muestran con lo que hace hoy en vez de
 * con un stepper apagado. Un control que no cambia nada es peor que su
 * ausencia: promete una configuración que no existe.
 */
export function TabEscalado({
  valores,
  onChange,
  disabled,
}: {
  valores: AgenteConfigValores;
  onChange: (patch: Partial<AgenteConfigValores>) => void;
  disabled?: boolean;
}) {
  const cotizacionActiva = valores.escalar_cotizacion_desde !== null;

  return (
    <div className="grid grid-cols-[1.35fr_1fr] items-start gap-5">
      <TarjetaConsola
        titulo="Cuándo pasar a un humano"
        subtitulo="La primera condición que se cumpla pausa la IA y manda la conversación al triage."
      >
        <ul className="flex flex-col">
          <FilaCondicion
            label="El cliente pide hablar con una persona"
            detalle="Pausa la IA y manda la conversación al triage."
            Icon={PanTool}
            color="var(--color-special)"
            nota="Sin construir: no hay un detector propio. Hoy se aproxima con una regla IF/THEN de tipo «Escala a un humano» sobre un intent que represente el pedido, o pausando la IA a mano desde la Bandeja."
          />

          <FilaCondicion
            label="Intents desconocidos seguidos"
            detalle="Cuando el clasificador no reconoce nada varias veces en fila."
            Icon={HelpIcon}
            color="var(--color-warn)"
            control={
              <Stepper
                valor={valores.escalar_umbral_intents}
                texto={`${valores.escalar_umbral_intents} seguidos`}
                min={UMBRAL_INTENTS_MIN}
                max={UMBRAL_INTENTS_MAX}
                paso={1}
                etiqueta="intents desconocidos seguidos"
                onChange={(v) => onChange({ escalar_umbral_intents: v })}
                disabled={disabled}
              />
            }
            nota={
              <>
                Se guarda y se versiona, pero el worker de auto-handoff todavía evalúa con el valor
                de fábrica ({UMBRAL_INTENTS_MIN + 1}): falta pasarle la config al construirlo en el
                bootstrap de Inngest. También depende del feature flag{" "}
                <code className="font-mono">auto_handoff.enabled</code>, que se cambia fuera de la
                app.
              </>
            }
          />

          <FilaCondicion
            label="Cotización mayor a"
            detalle="Con una cotización por encima del monto, el siguiente turno ya no lo contesta la IA."
            Icon={Sell}
            color="var(--color-brand)"
            control={
              <>
                {cotizacionActiva ? (
                  <Stepper
                    valor={valores.escalar_cotizacion_desde ?? COTIZACION_INICIAL}
                    texto={formatPesos(valores.escalar_cotizacion_desde ?? COTIZACION_INICIAL)}
                    min={COTIZACION_MIN}
                    max={COTIZACION_MAX}
                    paso={COTIZACION_PASO}
                    etiqueta="monto de cotización que escala"
                    onChange={(v) => onChange({ escalar_cotizacion_desde: v })}
                    disabled={disabled}
                  />
                ) : null}
                <SwitchConsola
                  activo={cotizacionActiva}
                  etiqueta="Escalar por monto cotizado"
                  onChange={(v) =>
                    onChange({ escalar_cotizacion_desde: v ? COTIZACION_INICIAL : null })
                  }
                  disabled={disabled}
                />
              </>
            }
            nota="Mira el precio ya cotizado en la ficha de la sesión, así que actúa desde el turno siguiente al que dejó la cotización cargada."
          />

          <FilaCondicion
            label="Urgencia alta sin cerrar en"
            detalle="Un tiempo máximo para una conversación urgente."
            Icon={Bolt}
            color="var(--color-caution)"
            nota="Sin construir: la sesión guarda su urgencia y el motor de reglas puede condicionar por ella, pero nadie mide cuánto lleva abierta ni dispara nada al vencer un plazo. Sin eso, un valor acá no tendría quién lo leyera."
          />

          <FilaCondicion
            label="Fuera de horario"
            detalle="Qué pasa cuando el negocio está cerrado."
            Icon={Schedule}
            color="var(--color-info)"
            nota="No es configurable: fuera del horario de «Límites y costo» el agente responde con la plantilla y corta antes de evaluar nada más, así que no hay dónde decidir si además escala. La conversación queda esperando, no entra al triage."
          />
        </ul>
      </TarjetaConsola>

      <div className="sticky top-[22px] flex min-w-0 flex-col gap-5">
        <TarjetaConsola
          titulo="Palabras que escalan siempre"
          subtitulo="Coinciden sin importar el intent detectado."
        >
          <PalabrasEscalado
            palabras={valores.escalar_palabras}
            onChange={(escalar_palabras) => onChange({ escalar_palabras })}
            disabled={disabled}
          />
        </TarjetaConsola>

        <TarjetaConsola titulo="A quién le llega" subtitulo="Orden de reparto y disponibilidad.">
          <p className="text-ink-faint text-[10.5px]">
            Sin construir. Una conversación escalada queda con la IA pausada y visible para todo el
            equipo: no hay asignación ni estado de presencia por vendedor.
          </p>
          <MonoMeta className="mt-2 block">
            el handoff también lo deja pendiente — «presencia y bloqueo entre vendedores»
          </MonoMeta>
        </TarjetaConsola>
      </div>
    </div>
  );
}
