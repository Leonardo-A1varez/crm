import { Close, Done, DoneAll, ErrorIcon, Schedule } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Cifra } from "./primitivas";
import { ESTADO_ENTREGA, ETIQUETA_GRUPO, ORDEN_ESTADOS, tinte } from "./paleta";
import { formatearEntero } from "./formato";
import type { ConteoEntrega, EstadoEntrega, GrupoEstado } from "./tipos";
import type { LucideIcon } from "lucide-react";

/**
 * Los estados de entrega, la pieza más reusada de Difusión.
 *
 * Un ícono por estado y una etiqueta de texto siempre: el color nunca es lo
 * único que distingue dos estados. Los tildes son los de WhatsApp a propósito
 * —uno para "salió el pedido", dos para "llegó"—, y el cancelado lleva una
 * cruz: no salió ni va a salir.
 */
const ICONO: Record<EstadoEntrega, LucideIcon> = {
  en_cola: Schedule,
  aceptado: Done,
  entregado: DoneAll,
  leido: DoneAll,
  fallido: ErrorIcon,
  cancelado: Close,
};

export function EstadoEntregaPill({
  estado,
  className,
}: {
  estado: EstadoEntrega;
  className?: string;
}) {
  const { color, etiqueta } = ESTADO_ENTREGA[estado];
  const Icono = ICONO[estado];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-[7px] py-[3px] text-[10.5px] font-semibold",
        className,
      )}
      style={{ color, backgroundColor: tinte(color, 12) }}
    >
      <Icono size={12} aria-hidden />
      {etiqueta}
    </span>
  );
}

/**
 * El desglose partido en grupos con un separador.
 *
 * La partición es la idea del producto, no una decisión de layout: lo que
 * todavía no llegó a ningún teléfono, lo que se resolvió y lo que se frenó al
 * detener. Es lo que impide leer "aceptado + entregado" como una sola cifra de
 * enviados. El grupo de lo frenado aparece sólo si hay algo frenado, y va solo
 * por una razón de color que está en `paleta.ts`.
 */
export function DesgloseEntrega({
  conteo,
  total,
}: {
  conteo: ConteoEntrega;
  /** Para la barra de cada estado. */
  total: number;
}) {
  const grupos: GrupoEstado[] =
    conteo.cancelado > 0 ? ["en_vuelo", "resuelto", "frenado"] : ["en_vuelo", "resuelto"];

  return (
    <div className="flex flex-col gap-3">
      {grupos.map((grupo, i) => (
        <div
          key={grupo}
          className={cn("flex flex-col gap-2", i > 0 && "border-line-row border-t pt-3")}
        >
          <span className="text-ink-ghost text-[10px] font-medium">{ETIQUETA_GRUPO[grupo]}</span>
          <ul className="flex flex-col gap-2">
            {ORDEN_ESTADOS.filter((e) => ESTADO_ENTREGA[e].grupo === grupo).map((estado) => (
              <FilaEstado key={estado} estado={estado} cantidad={conteo[estado]} total={total} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function FilaEstado({
  estado,
  cantidad,
  total,
}: {
  estado: EstadoEntrega;
  cantidad: number;
  total: number;
}) {
  const { color, etiqueta, glosa } = ESTADO_ENTREGA[estado];
  const Icono = ICONO[estado];
  const ancho = total > 0 ? (cantidad / total) * 100 : 0;

  return (
    <li className="flex items-center gap-2.5">
      <Icono size={13} style={{ color }} aria-hidden className="shrink-0" />
      <span className="text-ink-secondary w-[70px] shrink-0 text-[11.5px] font-medium">
        {etiqueta}
      </span>
      <span className="bg-surface-input h-[5px] min-w-0 flex-1 overflow-hidden rounded-full">
        <span
          className="block h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${ancho}%`, backgroundColor: color }}
        />
      </span>
      <Cifra valor={formatearEntero(cantidad)} tamano="sm" color={color} className="w-14" />
      <span className="text-ink-ghost hidden w-[220px] shrink-0 text-[10.5px] xl:block">
        {glosa}
      </span>
    </li>
  );
}
