/**
 * Los disparos de workflows: qué viaja en `workflow/disparo.recibido` y cómo lo
 * arma cada emisor.
 *
 * Vive en `lib/` porque lo emiten dos lados que no se ven entre sí: las
 * funciones de Inngest (el pipeline de mensajes, el cron, el escaneo de
 * inactividad) y las Server Actions del panel (el disparo manual, los cambios
 * que una persona hace a mano). `app/**` no puede importar `src/inngest/**`.
 *
 * El `id` de cada disparo es la clave de deduplicación de Inngest: dos envíos
 * con el mismo `id` son un solo disparo. Por eso se arma con lo que identifica
 * **al hecho** —el mensaje, el click, la franja horaria—, nunca con la hora a
 * la que se lo mandó.
 */

import type { Canal, CurrentStage } from "@/types/domain";
import type { UUID } from "@/types/entities";
import type { DatosDisparo } from "@/types/workflows";
import type { DisparadorWorkflow } from "./catalogo";
import { contextoDeDisparo, type FuenteContexto } from "./contexto";

/**
 * Lo que trae el evento `workflow/disparo.recibido`.
 *
 * `type` y no `interface`, a propósito: `staticSchema<T>()` de Inngest exige
 * `T extends Record<string, unknown>` (`node_modules/inngest/components/
 * triggers/triggers.d.ts`), y TypeScript sólo le da la firma de índice
 * implícita a un alias de tipo objeto, nunca a una interface.
 */
export type DispararWorkflowInput = {
  disparador: DisparadorWorkflow;
  leadId: UUID;
  leadSessionId?: UUID;
  /**
   * El único flujo que puede arrancar este disparo. Obligatorio en los
   * dirigidos (`DISPARADORES_DIRIGIDOS`): sin él, `workflow-disparar` no
   * arranca nada. En los demás es opcional y, si viene, también restringe.
   */
  workflowId?: UUID;
  /** Lo que queda en `workflow_runs.contexto`. Ver `contextoDeDisparo`. */
  contexto: Record<string, unknown>;
  /**
   * Para los filtros del trigger (qué etiqueta, qué etapa, qué canal). No se
   * persiste. Sin datos, un trigger con filtro no arranca: falla cerrado.
   */
  datos?: DatosDisparo;
};

/** Un disparo listo para mandar. `id` es la clave de deduplicación de Inngest. */
export interface DisparoWorkflow {
  data: DispararWorkflowInput;
  id: string;
}

/** La sesión tal como la necesita un disparo: su id y lo que siembra el contexto. */
export type SesionDelDisparo = NonNullable<FuenteContexto["sesion"]> & { id: UUID };

export interface DisparoManualInput {
  workflowId: UUID;
  /**
   * Lo genera la pantalla por cada click. El mismo click reenviado —un doble
   * click, un reintento de red— es un solo disparo; dos clicks son dos.
   */
  solicitudId: string;
  lead: { id: UUID; nombre: string };
  /** La sesión activa del lead. Sin una, la corrida arranca sin sesión. */
  sesion: SesionDelDisparo | null;
  canal: Canal;
}

/** "Manual": una persona dispara un flujo puntual para un lead puntual. */
export function disparoManual(input: DisparoManualInput): DisparoWorkflow {
  return {
    id: `workflow-disparo:manual:${input.workflowId}:${input.lead.id}:${input.solicitudId}`,
    data: {
      disparador: "manual",
      workflowId: input.workflowId,
      leadId: input.lead.id,
      ...(input.sesion ? { leadSessionId: input.sesion.id } : {}),
      contexto: contextoDeDisparo({ lead: input.lead, sesion: input.sesion, canal: input.canal }),
    },
  };
}

/**
 * Lo que identifica a un cambio hecho a mano desde el panel: quién lo hizo no
 * importa, cuándo sí. La action toma la hora una sola vez y la usa en el `id`,
 * así la reentrega del mismo envío es un solo disparo.
 *
 * Límite conocido: dos clicks casi simultáneos que ven los dos el estado de
 * antes (la etiqueta todavía no estaba) producen dos disparos. Los ataja
 * `arrancar_workflow_run`, que ignora una segunda corrida viva del mismo flujo
 * para el mismo lead; si el flujo ya terminó, corre dos veces.
 */
export interface CambioManualBase {
  lead: { id: UUID; nombre: string };
  sesion: SesionDelDisparo | null;
  canal: Canal;
  /** ISO de cuándo lo vio hacer la action. */
  marca: string;
}

/** Una persona le puso (`asignada`) o le sacó (`removida`) una etiqueta al lead. */
export function disparoEtiquetaManual(
  input: CambioManualBase & { tagId: UUID; cambio: "asignada" | "removida" },
): DisparoWorkflow {
  return {
    id: `workflow-disparo:etiqueta-${input.cambio}-manual:${input.lead.id}:${input.tagId}:${input.marca}`,
    data: {
      disparador: input.cambio === "asignada" ? "etiqueta_asignada" : "etiqueta_removida",
      leadId: input.lead.id,
      ...(input.sesion ? { leadSessionId: input.sesion.id } : {}),
      contexto: contextoDeDisparo({ lead: input.lead, sesion: input.sesion, canal: input.canal }),
      datos: { tagId: input.tagId },
    },
  };
}

/** Una persona movió la etapa desde el rail del Twin. `sesion` es la de después del cambio. */
export function disparoEtapaManual(
  input: CambioManualBase & { sesion: SesionDelDisparo; etapaAnterior: CurrentStage },
): DisparoWorkflow {
  return {
    id: `workflow-disparo:etapa-manual:${input.sesion.id}:${input.sesion.current_stage}:${input.marca}`,
    data: {
      disparador: "etapa_cambiada",
      leadId: input.lead.id,
      leadSessionId: input.sesion.id,
      contexto: contextoDeDisparo({ lead: input.lead, sesion: input.sesion, canal: input.canal }),
      datos: { etapaAnterior: input.etapaAnterior, etapaNueva: input.sesion.current_stage },
    },
  };
}

/**
 * A la sesión le cambió el vendedor por una acción de un flujo ("Asignar
 * vendedor" o "Round Robin"). Despierta a los "Esperar evento: vendedor
 * asignado" del lead y arranca los flujos "Vendedor asignado".
 *
 * `marca` identifica la asignación: la hora con que la selló la base
 * (`lead_session.asignado_at`). Un reintento del mismo paso lee la misma hora y
 * es un solo disparo.
 *
 * Es el único disparo que emite una acción de un flujo, y por eso el único
 * con riesgo de bucle: dos flujos "Vendedor asignado" que reasignan cada uno a
 * otra persona se disparan entre sí sin fin. Asignar al vendedor que ya tiene
 * no emite nada, así que un flujo solo no cicla.
 */
export function disparoVendedorAsignado(input: {
  leadId: UUID;
  sesion: SesionDelDisparo;
  vendedorId: UUID;
  marca: string;
}): DisparoWorkflow {
  return {
    id: `workflow-disparo:vendedor-asignado:${input.sesion.id}:${input.vendedorId}:${input.marca}`,
    data: {
      disparador: "vendedor_asignado",
      leadId: input.leadId,
      leadSessionId: input.sesion.id,
      contexto: contextoDeDisparo({ sesion: input.sesion }),
    },
  };
}
