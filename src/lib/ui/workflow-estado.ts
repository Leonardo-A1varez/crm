import { WORKFLOW_ESTADOS } from "@/types/entities";
import type { WorkflowEstado } from "@/types/entities";

/**
 * Estado de un flujo en `/workflows`: cómo se deriva, cómo se llama y de qué
 * color se pinta. Fuente única.
 *
 * Vive en `lib/ui/` y no en `components/` porque
 * `WorkflowsAdminService.listarConResumen` necesita `derivarEstadoWorkflow`, y
 * los boundaries de ESLint no dejan que `server/services/**` importe
 * `components/**` (sí `lib/**`). Por el mismo motivo acá no hay ningún ícono:
 * `lib/**` sólo puede importar `lib` y `types`, así que el glifo de cada estado
 * —que es la codificación secundaria, no decoración— lo agrega
 * `components/workflows/lista/estado.ts`, que es la capa que sí puede importar
 * `@/components/icons`.
 *
 * Hasta el 2026-09-03 esto convivía con una copia en
 * `components/workflows/lista/estado.ts`: dos derivaciones, dos juegos de
 * labels y dos paletas, una de ellas en Tailwind crudo.
 */

/** Los cinco estados, en orden de ciclo de vida. Re-export del tipo. */
export const ESTADOS_WORKFLOW = WORKFLOW_ESTADOS;

/**
 * Deriva el estado. El orden importa y no es alfabético ni arbitrario: va del
 * hecho que más determina qué puede pasar al que menos.
 *
 *   1. Sin versión publicada -> `borrador`, pase lo que pase con el resto. Un
 *      flujo que nunca publicó nada no pudo haber corrido nunca.
 *   2. Apagado -> `pausado`. Es la decisión deliberada de una persona y tapa
 *      cualquier fallo viejo: un flujo que se apagó PORQUE fallaba no tiene que
 *      seguir gritando error mientras está apagado.
 *   3. La última corrida falló -> `con-errores`. Le gana a `con-cambios` porque
 *      un flujo que rompe es urgente y una edición sin publicar no lo es. El
 *      borrador pendiente no se pierde: la tarjeta lo dice igual en la línea de
 *      abajo, sólo que no le roba el badge a algo que está fallando.
 *   4. Hay una versión más nueva que la publicada -> `con-cambios`.
 *   5. Si no -> `activo`.
 */
export function derivarEstadoWorkflow(input: {
  activo: boolean;
  tieneVersionPublicada: boolean;
  tieneVersionBorrador: boolean;
  ultimoRunFallado: boolean;
}): WorkflowEstado {
  if (!input.tieneVersionPublicada) return "borrador";
  if (!input.activo) return "pausado";
  if (input.ultimoRunFallado) return "con-errores";
  if (input.tieneVersionBorrador) return "con-cambios";
  return "activo";
}

/**
 * ¿Este flujo puede dispararse ahora mismo?
 *
 * Existe porque el subtítulo de la pantalla dice "N corriendo" y antes lo
 * calculaba con `estado === "activo"`. Con cuatro estados eso era correcto por
 * accidente; con cinco deja afuera a `con-cambios` y a `con-errores`, que están
 * publicados y encendidos —uno tiene una edición sin publicar, el otro falló la
 * última vez— y se disparan igual. La definición vive acá para que no se
 * re-deduzca en cada call site.
 */
export function estaEnMarcha(estado: WorkflowEstado): boolean {
  return estado !== "borrador" && estado !== "pausado";
}

/**
 * El contrato de pausar, palabra por palabra. Vive en una constante y no suelto
 * en el JSX porque se muestra en tres lugares —el ítem del menú que pausa, la
 * tarjeta ya pausada y la leyenda de estados— y tres copias divergen.
 *
 * Que "pausar" signifique una cosa u otra es una queja documentada del mercado:
 * en varias herramientas nadie sabe si apagar un flujo mata también lo que ya
 * está corriendo. Acá se dice, no se deja implícito.
 */
export const SEMANTICA_PAUSA = {
  frena: "No dispara corridas nuevas.",
  respeta: "Las que ya están corriendo siguen hasta terminar.",
  /** Una línea, para donde no entran dos. */
  completa: "No dispara corridas nuevas. Las que ya están corriendo siguen hasta terminar.",
} as const;

export interface EstadoWorkflowDescriptor {
  label: string;
  /**
   * Token de color del estado, como `var()`. El tema lo resuelve; este módulo
   * no sabe si está en claro u oscuro y no tiene por qué saberlo.
   *
   * Son `var()` y no clases de Tailwind a propósito. La versión anterior de
   * este archivo pintaba los estados con `bg-emerald-500` / `bg-amber-500` /
   * `bg-red-500`: colores crudos, fuera del sistema de tokens, sin calibrar
   * contra la paleta del proyecto y sin ningún vínculo con el tema.
   */
  color: string;
  /** Qué significa, en una línea. Se muestra en pantalla; no es un comentario. */
  significado: string;
}

/**
 * Label, color y significado de cada estado.
 *
 * Por qué el color NO alcanza y cada consumidor tiene que acompañarlo de glifo
 * y palabra: el validador de paleta (`node scripts/verificar-paleta-clara.mjs`)
 * mide que en tema claro `caution` (#8f5509) y `danger` (#c52a4d) —los colores
 * de `pausado` y `con-errores`, que comparten esta misma pantalla— se separan
 * ΔE 15.2 en visión normal pero 6.0 en deuteranopía. La vara del validador es
 * 8 como objetivo y 6 como piso, y la banda 6-8 es legal SÓLO con codificación
 * secundaria. En claro no hay hex que lo arregle: el arco cálido no da para
 * `warn`, `caution` y `danger` a la vez. Así que el glifo no es un parche hasta
 * que alguien ajuste la paleta, es permanente.
 */
export const ESTADO_WORKFLOW: Record<WorkflowEstado, EstadoWorkflowDescriptor> = {
  borrador: {
    label: "Borrador",
    color: "var(--color-ink-faint)",
    significado: "Nunca se publicó. No puede dispararse.",
  },
  activo: {
    label: "Activo",
    color: "var(--color-ok)",
    significado: "Publicado y disparándose.",
  },
  "con-cambios": {
    label: "Con cambios",
    color: "var(--color-info)",
    significado: "Corre la versión publicada; hay un borrador más nuevo sin publicar.",
  },
  pausado: {
    label: "Pausado",
    color: "var(--color-caution)",
    significado: SEMANTICA_PAUSA.completa,
  },
  "con-errores": {
    label: "Con errores",
    color: "var(--color-danger)",
    significado: "Las últimas corridas terminaron mal.",
  },
};

/** Atajo para los call sites que sólo quieren el nombre. */
export const ESTADO_WORKFLOW_LABEL: Record<WorkflowEstado, string> = {
  borrador: ESTADO_WORKFLOW.borrador.label,
  activo: ESTADO_WORKFLOW.activo.label,
  "con-cambios": ESTADO_WORKFLOW["con-cambios"].label,
  pausado: ESTADO_WORKFLOW.pausado.label,
  "con-errores": ESTADO_WORKFLOW["con-errores"].label,
};

/**
 * Fondo tintado del propio color, no una superficie fija.
 *
 * `color-mix` y no un sufijo de alpha en hex porque el color entra como
 * `var(--color-ok)`: concatenarle `21` produciría el string literal
 * `var(--color-ok)21`, que el navegador descarta entero.
 */
export function tinte(color: string, porcentaje: number): string {
  return `color-mix(in srgb, ${color} ${porcentaje}%, transparent)`;
}
