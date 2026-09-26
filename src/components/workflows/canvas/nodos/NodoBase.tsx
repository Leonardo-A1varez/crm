"use client";

import { Handle, Position } from "@xyflow/react";
import type { ComponentType, ReactNode } from "react";
import {
  AltRoute,
  Bolt,
  ContactEmergency,
  Handyman,
  Psychology,
  SendIcon,
  SettingsSuggest,
  Campaign,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  categoriaChipFondo,
  categoriaColor,
  categoriaDescripcion,
  categoriaLabel,
  clasesEtiquetaEstado,
  clasesPuerto,
  clasesTarjetaNodo,
  etiquetaEstado,
  posicionPuerto,
  tonoDePuerto,
  type EstadoNodo,
  type TonoPuerto,
} from "@/lib/ui/workflow-nodos";
import type { CategoriaVisual } from "@/types/workflows";

/**
 * Tarjeta base de todo nodo del canvas.
 *
 * La lógica de color y estado NO vive acá: vive en `src/lib/ui/workflow-nodos.ts`,
 * que además documenta por qué la categoría se dibuja en el chip del ícono y el
 * estado en el borde, y de dónde salen los números de contraste.
 *
 * Anatomía, de arriba a abajo:
 *
 *   ╭─ handle de entrada (arriba, centrado) ─╮
 *   │ [chip+ícono] Nombre        [estado]    │  encabezado
 *   ├────────────────────────────────────────┤
 *   │ Canal WhatsApp · intercepta el LLM     │  resumen en prosa
 *   │ [Sí]                          [No]     │  chips de puerto
 *   ╰─ handles de salida (abajo, bajo cada chip) ─╯
 *
 * Ancho fijo de 200px, alto según contenido. Fijo porque un canvas con tarjetas
 * de anchos distintos no deja leer la columna de nodos como una lista, que es
 * como se escanea un flujo largo.
 */

/**
 * Tipo estructural, no `LucideIcon`.
 *
 * Los íconos entran por `@/components/icons` —los alias sobre lucide— y este
 * archivo no importa `lucide-react` ni siquiera para el tipo: describirlo por su
 * forma deja la dependencia en un solo lugar del proyecto, que es el punto de
 * tener el módulo de alias.
 */
export type IconoNodo = ComponentType<{ className?: string }>;

/** Ícono por defecto de cada categoría, cuando el tipo concreto no trae el suyo. */
const ICONO_CATEGORIA: Record<CategoriaVisual, IconoNodo> = {
  trigger: Bolt,
  mensajeria: SendIcon,
  crm: ContactEmergency,
  logica: AltRoute,
  integracion: Handyman,
  ia: Psychology,
  interno: SettingsSuggest,
  difusion: Campaign,
};

/** Una salida del nodo. El tono se deriva del `id`; ver `tonoDePuerto`. */
export interface SalidaNodo {
  id: string;
  label: string;
  /** Sólo para forzar un tono que la convención de nombres no acierte. */
  tono?: TonoPuerto;
}

export interface NodoBaseProps {
  nombre: string;
  categoria: CategoriaVisual;
  /** Del módulo de alias. Si falta, el de la categoría. */
  icono?: IconoNodo;
  selected: boolean;
  /**
   * Resumen de la config **en lenguaje natural**, nunca JSON ni el objeto
   * crudo. Los valores concretos van envueltos en `<Dato>` para que salgan en
   * Geist Mono. Ejemplo: `Canal <Dato>WhatsApp</Dato> · intercepta el LLM`.
   */
  children: ReactNode;
  /** `false` sólo en los disparadores: son los únicos sin entrada. */
  tieneEntrada?: boolean;
  tieneSalida?: boolean;
  /** Reemplaza a `tieneSalida` cuando el nodo ramifica. */
  salidas?: SalidaNodo[];
  estado?: EstadoNodo;
  /**
   * Hora para `memoizado` ("14:32"), duración para `ejecutando` ("36s"). Sale en
   * Geist Mono porque es un dato que se escanea, no prosa que se lee.
   */
  datoEstado?: string;
}

/**
 * Valor concreto dentro del resumen: un canal, una etapa, un umbral.
 *
 * Existe para que la regla "todo dato que se compara o se escanea va en Geist
 * Mono" no dependa de que cada componente de nodo se acuerde de escribir
 * `font-mono`. Si el valor está acá adentro, sale bien.
 */
export function Dato({ children }: { children: ReactNode }) {
  return <span className="text-ink-secondary font-mono">{children}</span>;
}

/**
 * Estilo del punto de conexión.
 *
 * Va por `style` y no por clases con `!important`: React Flow inyecta su propia
 * hoja para `.react-flow__handle`, y un estilo en línea le gana sin depender de
 * la sintaxis del modificador importante, que cambió entre Tailwind v3 y v4.
 */
const ESTILO_HANDLE = {
  width: 9,
  height: 9,
  background: "var(--surface-panel)",
  border: "1.5px solid var(--line-control)",
} as const;

/**
 * Área de toque del handle.
 *
 * El punto se ve de 9px pero el blanco de click mide 25px gracias al
 * pseudo-elemento: WCAG SC 2.5.8 pide 24px mínimo y arrastrar una conexión
 * desde un punto de 9px es, en la práctica, imposible con trackpad.
 */
const HIT_AREA_HANDLE = "before:absolute before:-inset-2 before:content-[''] hover:border-brand!";

export function NodoBase({
  nombre,
  categoria,
  icono,
  selected,
  children,
  tieneEntrada = true,
  tieneSalida = true,
  salidas,
  estado = "normal",
  datoEstado,
}: NodoBaseProps) {
  const Icono = icono ?? ICONO_CATEGORIA[categoria];
  const etiqueta = etiquetaEstado(estado, datoEstado);
  const clasesEtiqueta = clasesEtiquetaEstado(estado);
  const color = categoriaColor(categoria);

  // Sin `salidas`, `tieneSalida` decide si hay un único puerto centrado.
  const puertos = salidas ?? (tieneSalida ? [{ id: "salida", label: "" }] : []);
  const conChips = salidas !== undefined && salidas.length > 0;

  return (
    <div
      className={cn("relative min-h-14 w-50", clasesTarjetaNodo(estado, selected))}
      aria-label={`${categoriaLabel(categoria)}: ${nombre}${etiqueta ? `. ${etiqueta.texto}${etiqueta.dato ? ` ${etiqueta.dato}` : ""}` : ""}`}
    >
      {tieneEntrada && (
        <Handle
          type="target"
          position={Position.Top}
          style={ESTILO_HANDLE}
          className={HIT_AREA_HANDLE}
        />
      )}

      <header className="border-line-row flex items-center gap-2 border-b px-2.5 py-2">
        {/* El color de la categoría vive acá, en el ícono, y no en el nombre:
            como texto de 11.5px sobre su propio tinte, 4 de las 7 categorías no
            llegan a 4.5:1 (los números están en workflow-nodos.ts). Como
            elemento gráfico la vara es 3:1 y las 7 pasan en los dos temas.
            `color` en el chip y no en el `<Icono>`: los íconos de lucide pintan
            con `currentColor`, así que heredan sin prop extra. */}
        <span
          className="grid size-4.5 shrink-0 place-items-center rounded-[5px]"
          style={{ background: categoriaChipFondo(categoria), color }}
          title={categoriaDescripcion(categoria)}
        >
          <Icono className="size-3" />
        </span>
        <span className="text-ink-primary min-w-0 flex-1 truncate text-[11.5px] leading-tight font-semibold">
          {nombre}
        </span>
        {/* `memoizado` y `stale` NO ponen badge acá: su texto es una frase, no
            una palabra, y se dibuja abajo a ancho completo. Rendearlo en los
            dos lados repetía la hora. */}
        {etiqueta && clasesEtiqueta && estado !== "memoizado" && estado !== "stale" && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold",
              clasesEtiqueta,
            )}
          >
            {estado === "ejecutando" && (
              <span className="animate-pulse-dot size-1 shrink-0 rounded-full bg-current motion-reduce:animate-none" />
            )}
            {etiqueta.dato ? <span className="font-mono">{etiqueta.dato}</span> : etiqueta.texto}
          </span>
        )}
      </header>

      <div className="text-ink-faint px-2.5 pt-2 pb-2.5 text-[11px] leading-[1.45]">
        <p className="line-clamp-3">{children}</p>
      </div>

      {/* La etiqueta larga de memoizado/stale no entra en el badge del header:
          va acá abajo, donde puede ocupar el ancho completo. */}
      {etiqueta && (estado === "memoizado" || estado === "stale") && (
        <p className="text-ink-ghost px-2.5 pb-2.5 text-[9.5px] leading-snug">
          {etiqueta.texto}
          {etiqueta.dato && <span className="text-ink-faint font-mono"> {etiqueta.dato}</span>}
        </p>
      )}

      {conChips && (
        <div className="flex gap-0.5 px-2.5 pb-2.5">
          {salidas.map((salida) => (
            <span
              key={salida.id}
              className={cn(
                "flex-1 truncate rounded-[5px] px-1 py-0.5 text-center font-mono text-[8.5px] leading-tight font-semibold",
                clasesPuerto(salida.tono ?? tonoDePuerto(salida.id)),
              )}
            >
              {salida.label}
            </span>
          ))}
        </div>
      )}

      {puertos.map((puerto, i) => (
        <Handle
          key={puerto.id}
          type="source"
          id={puerto.id}
          position={Position.Bottom}
          style={{
            ...ESTILO_HANDLE,
            ...(puertos.length > 1 ? { left: posicionPuerto(i, puertos.length) } : {}),
          }}
          className={HIT_AREA_HANDLE}
        />
      ))}
    </div>
  );
}
