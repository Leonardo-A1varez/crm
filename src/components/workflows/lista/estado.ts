import { DuplicateIcon, Edit, ErrorIcon, PauseIcon, TaskAlt } from "@/components/icons";
import {
  ESTADOS_WORKFLOW,
  ESTADO_WORKFLOW,
  SEMANTICA_PAUSA,
  derivarEstadoWorkflow,
  estaEnMarcha,
  tinte,
} from "@/lib/ui/workflow-estado";
import type { EstadoWorkflowDescriptor } from "@/lib/ui/workflow-estado";
import type { WorkflowEstado } from "@/types/entities";
import type { ComponentType } from "react";

/**
 * La mitad del estado de un flujo que necesita React: el glifo.
 *
 * Todo lo demás —los cinco valores, cómo se derivan, el label, el color y el
 * significado— vive en `@/lib/ui/workflow-estado` y de acá sólo se re-exporta.
 * El corte no es estético: `WorkflowsAdminService` deriva el estado y los
 * boundaries de ESLint no dejan que `server/services/**` importe
 * `components/**`, así que la lógica tiene que estar en `lib/**`; y `lib/**`
 * sólo puede importar `lib` y `types`, así que un `ComponentType` de
 * `@/components/icons` no puede estar ahí. Cada mitad queda donde la capa la
 * admite y el consumidor sigue viendo un solo objeto.
 */

export { ESTADOS_WORKFLOW as ESTADOS_FLUJO, SEMANTICA_PAUSA, estaEnMarcha, tinte };
export { derivarEstadoWorkflow as derivarEstadoFlujo };
export type EstadoFlujo = WorkflowEstado;

/**
 * Glifo del estado. NO es decoración: es la codificación secundaria que hace
 * legible el badge sin depender del color.
 *
 * El validador de paleta (`dataviz/scripts/validate_palette.js`) reprobaba dos
 * pares de esta paleta y los dos aparecen en esta pantalla:
 *   claro  caution #b45309 <-> danger #dc2626  ->  ΔE 9.9 en visión normal
 *          (el piso duro es 15) y 2.8 en deuteranopía
 *   oscuro ok #34d399      <-> danger #f87171  ->  ΔE 6.5 en deuteranopía
 * O sea: "con errores" y un aviso ámbar eran casi el mismo color para
 * cualquiera, y verde y rojo lo eran para quien no distingue esos dos.
 *
 * El 2026-09-03 los tokens se re-escalonaron en `globals.css` y los dos pares
 * mejoraron (reproducible con `node scripts/verificar-paleta-clara.mjs`):
 *   claro  caution #8f5509 <-> danger #c52a4d  ->  15.2 normal · 6.0 CVD
 *   oscuro ok      #31d7a5 <-> danger #f9667c  ->  33.2 normal · 8.0 CVD
 *
 * El de oscuro quedó limpio; el de claro pasó el piso duro de 15 pero se quedó
 * en la banda CVD 6-8, que el propio validador admite SÓLO con codificación
 * secundaria. Así que ésta no se toca: cinco siluetas distintas (lápiz, tilde,
 * dos hojas, dos barras, triángulo en círculo) más el texto del label. El color
 * queda tercero. En claro no hay hex que lo arregle —el arco cálido no da para
 * `warn`, `caution` y `danger` a la vez—, así que el glifo es permanente, no un
 * parche hasta que alguien ajuste la paleta.
 */
export type GlifoEstado = ComponentType<{
  size?: number;
  className?: string;
  strokeWidth?: number;
}>;

const GLIFO: Record<EstadoFlujo, GlifoEstado> = {
  borrador: Edit,
  activo: TaskAlt,
  "con-cambios": DuplicateIcon,
  pausado: PauseIcon,
  "con-errores": ErrorIcon,
};

export interface DescriptorEstado extends EstadoWorkflowDescriptor {
  glifo: GlifoEstado;
}

/** Los cuatro datos del estado en un solo objeto, para el que dibuja. */
export const DESCRIPTOR_ESTADO: Record<EstadoFlujo, DescriptorEstado> = {
  borrador: { ...ESTADO_WORKFLOW.borrador, glifo: GLIFO.borrador },
  activo: { ...ESTADO_WORKFLOW.activo, glifo: GLIFO.activo },
  "con-cambios": { ...ESTADO_WORKFLOW["con-cambios"], glifo: GLIFO["con-cambios"] },
  pausado: { ...ESTADO_WORKFLOW.pausado, glifo: GLIFO.pausado },
  "con-errores": { ...ESTADO_WORKFLOW["con-errores"], glifo: GLIFO["con-errores"] },
};
