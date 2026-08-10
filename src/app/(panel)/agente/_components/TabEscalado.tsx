import { Bolt, HelpIcon, PanTool, Schedule, Sell } from "@/components/icons";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { TarjetaConsola } from "./TarjetaConsola";
import type { ComponentType, CSSProperties, ReactNode } from "react";

type Estado = "vive-en-codigo" | "otra-pantalla" | "sin-construir";

interface Condicion {
  label: string;
  detalle: string;
  Icon: ComponentType<{ className?: string; size?: number; style?: CSSProperties }>;
  color: string;
  estado: Estado;
  /** Qué falta, o dónde vive hoy. Nunca un valor de ejemplo. */
  nota: ReactNode;
}

const ETIQUETA_ESTADO: Record<Estado, string> = {
  "vive-en-codigo": "fijo en código",
  "otra-pantalla": "se configura en otra pestaña",
  "sin-construir": "sin construir",
};

/**
 * §4.2 pide cinco condiciones con stepper y switch, chips de palabras que
 * escalan y una lista ordenable de destinatarios. Nada de eso está persistido:
 * `agente_config` tiene 14 campos y ninguno es de escalado.
 *
 * En vez de maquetar controles que no guardan nada, la pestaña muestra cada
 * condición del handoff con lo que el sistema hace hoy de verdad. Los valores
 * del handoff (2 intents, $500k, 10 min) son datos del prototipo y no se
 * muestran: inventarían una configuración que nadie puede cambiar.
 */
const CONDICIONES: readonly Condicion[] = [
  {
    label: "El cliente pide hablar con una persona",
    detalle: "Pausa la IA y manda la conversación al triage.",
    Icon: PanTool,
    color: "var(--color-special)",
    estado: "sin-construir",
    nota: "No hay un detector propio. Hoy se aproxima con una regla IF/THEN de tipo «Escala a un humano» sobre un intent que represente el pedido, o pausando la IA a mano desde la Bandeja.",
  },
  {
    label: "Intents desconocidos seguidos",
    detalle: "Cuando el clasificador no reconoce nada varias veces en fila.",
    Icon: HelpIcon,
    color: "var(--color-warn)",
    estado: "vive-en-codigo",
    nota: "Es la única condición implementada. El umbral está fijo en 3 turnos dentro de handoff.service y no se puede editar desde acá; además depende del feature flag auto_handoff.enabled, que se cambia fuera de la app.",
  },
  {
    label: "Cotización mayor a",
    detalle: "Un monto por encima del cual no cierra sola.",
    Icon: Sell,
    color: "var(--color-brand)",
    estado: "sin-construir",
    nota: "Nadie compara el monto cotizado contra un tope. Lo más parecido que existe es el descuento máximo (pestaña Comportamiento), que bloquea la respuesta cuando el agente ofrece más de lo permitido.",
  },
  {
    label: "Urgencia alta sin cerrar en",
    detalle: "Un tiempo máximo para una conversación urgente.",
    Icon: Bolt,
    color: "var(--color-caution)",
    estado: "sin-construir",
    nota: "La sesión guarda su urgencia y el motor de reglas puede condicionar por ella, pero nadie mide cuánto lleva abierta ni dispara nada al vencer un plazo.",
  },
  {
    label: "Fuera de horario",
    detalle: "Qué pasa cuando el negocio está cerrado.",
    Icon: Schedule,
    color: "var(--color-info)",
    estado: "otra-pantalla",
    nota: "Existe y funciona, pero no escala: fuera del horario configurado en «Límites y costo» el agente responde con la plantilla y no genera con LLM. La conversación queda esperando, no entra al triage.",
  },
];

export function TabEscalado() {
  return (
    <div className="grid grid-cols-[1.35fr_1fr] items-start gap-5">
      <TarjetaConsola
        titulo="Cuándo pasar a un humano"
        subtitulo="La primera condición que se cumpla debería pausar la IA y mandar la conversación al triage."
      >
        <ul className="flex flex-col">
          {CONDICIONES.map(({ label, detalle, Icon, color, estado, nota }) => (
            <li key={label} className="border-line-layout border-b py-3 last:border-0">
              <div className="flex items-start gap-2.5">
                <Icon size={18} className="mt-px shrink-0" style={{ color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-primary text-[12px] font-semibold">{label}</span>
                    <span className="text-ink-faint border-line-control rounded-[5px] border px-1.5 py-px font-mono text-[9px] tracking-[0.1em] uppercase">
                      {ETIQUETA_ESTADO[estado]}
                    </span>
                  </div>
                  <p className="text-ink-dim mt-0.5 text-[10.5px]">{detalle}</p>
                  <p className="text-ink-faint mt-1 text-[10.5px]">{nota}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-ink-ghost mt-3 text-[10.5px]">
          Los steppers y switches del diseño no están:{" "}
          <code className="font-mono">agente_config</code> no tiene campos de escalado, así que un
          control acá no tendría dónde guardar. Requiere migración.
        </p>
      </TarjetaConsola>

      <div className="sticky top-[22px] flex min-w-0 flex-col gap-5">
        <TarjetaConsola
          titulo="Palabras que escalan siempre"
          subtitulo="Coinciden sin importar el intent detectado."
        >
          <p className="text-ink-faint text-[10.5px]">
            Sin construir. No hay lista de palabras en ninguna tabla y el pipeline no mira el texto
            crudo antes de clasificar: decide por intent.
          </p>
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
