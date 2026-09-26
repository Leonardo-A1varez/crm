import { eventType, staticSchema } from "inngest";
import {
  EVENTO_DIFUSION_PROGRAMADA,
  EVENTO_DIFUSION_REANUDADA,
  type DifusionProgramada,
  type DifusionReanudada,
} from "@/lib/difusion/eventos";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import type { IntentClassification } from "@/lib/validation/ai";
import type { DispararWorkflowInput } from "@/lib/workflows/disparos";
import type { Canal, EstadoEntrega } from "@/types/domain";
import type { UUID } from "@/types/entities";

export const messageReceived = eventType("meta/message.received", {
  schema: staticSchema<{ parsed: ParsedMessage }>(),
});

// Cambio de estado de entrega de un saliente. `at` viaja en ISO porque una
// `Date` no sobrevive la serializacion del evento.
export const statusReceived = eventType("meta/status.received", {
  schema: staticSchema<{
    parsed: {
      meta_message_id: string;
      estado: EstadoEntrega;
      at: string;
      error: string | null;
      // Opcionales: los eventos encolados antes de que el parser los leyera
      // no los traen, y se tienen que seguir procesando.
      error_codigo?: string | null;
      error_detalle?: string | null;
    };
  }>(),
});

// `mensajeOrigenId` es el entrante que disparó el turno: el Twin lo anota en la
// procedencia de cada campo para poder decir de qué mensaje salió el dato.
// Opcional porque los eventos ya encolados con la forma vieja tienen que seguir
// procesándose.
/**
 * Eventos operativos de la plataforma de Meta: le pasan a la cuenta, no a una
 * conversación. Plantilla aprobada o rechazada, cambio de límite del número,
 * revisión de la cuenta.
 *
 * `ocurrido_at` viaja en ISO por el mismo motivo que el `at` de los estados de
 * entrega: una `Date` no sobrevive la serialización del evento.
 */
export const operationalReceived = eventType("meta/operational.received", {
  schema: staticSchema<{
    campo: string;
    evento: string | null;
    objeto_id: string | null;
    objeto_nombre: string | null;
    payload: Record<string, unknown>;
    ocurrido_at: string | null;
  }>(),
});

export const turnCompleted = eventType("lead-session/turn.completed", {
  schema: staticSchema<{
    leadSessionId: UUID;
    conversationTurn: string[];
    mensajeOrigenId?: UUID;
  }>(),
});

export const autoHandoffEvaluate = eventType("lead-session/auto-handoff.evaluate", {
  schema: staticSchema<{
    leadSessionId: UUID;
    recentClassifications: IntentClassification[];
    threshold?: number;
  }>(),
});

export const handoffNotificationRequested = eventType(
  "lead-session/handoff.notification.requested",
  {
    schema: staticSchema<{
      handoffEventId: UUID;
      leadSessionId: UUID;
    }>(),
  },
);

export const detectIntentsBatchRequested = eventType("intents/detect.batch.requested", {
  schema: staticSchema<Record<string, never>>(),
});

export const sessionsPurgeRequested = eventType("sessions/purge.requested", {
  schema: staticSchema<Record<string, never>>(),
});

export const leadsReactivationRequested = eventType("leads/reactivation.requested", {
  schema: staticSchema<Record<string, never>>(),
});

/**
 * Un vendedor se puso una cita sobre una conversación ("volver a contactar en 2
 * días"). Lo emite el panel al programar el recordatorio y arranca el workflow
 * que duerme hasta `recordarAt`.
 *
 * `recordarAt` viaja en ISO porque una `Date` no sobrevive la serialización del
 * evento — mismo criterio que `meta/status.received`.
 *
 * Idempotency key al emitir: `recordatorio:<recordatorioId>`. El id lo genera
 * la fila, así que dos clicks sobre el mismo recordatorio no pueden abrir dos
 * workflows.
 */
export const recordatorioProgramado = eventType("lead-session/recordatorio.programado", {
  schema: staticSchema<{
    recordatorioId: UUID;
    leadSessionId: UUID;
    recordarAt: string;
  }>(),
});

/** Cancela únicamente la ejecución que se durmió con esta fecha exacta. */
export const recordatorioCancelado = eventType("lead-session/recordatorio.cancelado", {
  schema: staticSchema<{
    recordatorioId: UUID;
    recordarAt: string;
  }>(),
});

// Emit cuando un lead nuevo es creado durante `on-message-received` (resolve-lead
// stage). Dispara `detect-merge-candidates` per-lead (cheap heurística rápida).
// Idempotency event id (Slice 1): `lead-created:<leadId>`.
export const leadCreated = eventType("lead/created", {
  schema: staticSchema<{ leadId: UUID; canal: Canal }>(),
});

// Cron daily 5 AM scan global (catch races perdidas del per-event handler).
// Manual trigger via Inngest UI también soportado.
export const mergeCandidatesDetectRequested = eventType("merge-candidates/detect.requested", {
  schema: staticSchema<Record<string, never>>(),
});

// Outbox dispatcher cron (*/1 * * * *) o manual. Poll event_outbox pending rows
// y emit Inngest + mark sent. Garantiza at-least-once delivery aunque direct
// dispatch falle entre DB write y emit.
export const outboxDispatchRequested = eventType("outbox/dispatch.requested", {
  schema: staticSchema<Record<string, never>>(),
});

/**
 * Dispara el motor de workflows. Lo consume `workflow-disparar`.
 *
 * Emisores:
 * - `on-message-received`: `mensaje_recibido`, y `etiqueta_asignada` por cada
 *   etiqueta que una regla pone nueva.
 * - `update-lead-twin`: `etapa_cambiada` cuando el extractor mueve la etapa.
 * - `dispararWorkflowManualAction` (panel): `manual`, dirigido a un flujo.
 *
 * Todos con `id` determinístico: Inngest deduplica la reentrega. Los cambios que
 * hace un flujo con sus propias acciones NO emiten: así un flujo no se dispara a
 * sí mismo en bucle.
 *
 * `datos` alimenta los filtros del trigger y no se persiste; `contexto` es lo
 * que queda en `workflow_runs.contexto`; `workflowId` restringe a un flujo y es
 * obligatorio en los dirigidos (`DISPARADORES_DIRIGIDOS`).
 */
export const workflowDisparoRecibido = eventType("workflow/disparo.recibido", {
  schema: staticSchema<DispararWorkflowInput>(),
});

// `desdePaso` es el compare-and-swap: si no coincide con pasos_ejecutados, este
// segmento ya corrio y la reentrega no lo reejecuta.
// `respondio` sólo viaja al reanudar después de "Esperar respuesta" cuando el
// lead contestó antes del tiempo máximo, y `profundidad` al reanudar porque lo
// despertó un evento que la trae (ver `workflow-segmento.ts`).
export const workflowSegmentoPendiente = eventType("workflow/segmento.pendiente", {
  schema: staticSchema<{
    runId: UUID;
    desdePaso: number;
    respondio?: boolean;
    profundidad?: number;
    /** Sólo al reanudar un nodo con botones o lista: lo que eligió el lead. */
    opcionElegida?: { id: string; titulo: string };
  }>(),
});

/**
 * El lead eligió una opción de un mensaje con botones o de lista. Lo emite
 * `on-message-received` con la respuesta ya guardada en el hilo, y lo espera
 * `workflow-segmento` (`step.waitForEvent`) filtrando por lead y por
 * `respondeA`: el wamid del mensaje al que responde (`context.id` de Meta), así
 * una respuesta a un mensaje viejo no despierta la espera de uno nuevo.
 *
 * Idempotency key al emitir: `respuesta-interactiva:<wamid del entrante>`.
 */
export const workflowRespuestaInteractiva = eventType("workflow/respuesta.interactiva", {
  schema: staticSchema<{
    leadId: UUID;
    respondeA: string | null;
    opcionId: string;
    titulo: string;
  }>(),
});

/**
 * "Cancelar corrida" desde el panel. `workflow-segmento` lo declara en
 * `cancelOn` (match por `data.runId`): Inngest corta en el acto el segmento de
 * esa corrida que esté dormido en `step.waitForEvent`/`step.sleepUntil`, en vez
 * de dejarlo esperar hasta que venza. El estado en la base ya lo cerró la
 * acción antes de emitirlo; esto sólo apaga la ejecución de Inngest.
 */
export const workflowCorridaCancelada = eventType("workflow/corrida.cancelada", {
  schema: staticSchema<{ runId: UUID }>(),
});

/**
 * Revisa a mano los flujos "Programado" (además del cron de cada 5 minutos).
 * Sin datos: la hora que cuenta es la del evento.
 */
export const workflowProgramadosRevisar = eventType("workflow/programados.revisar", {
  schema: staticSchema<Record<string, never>>(),
});

/** Revisa a mano los flujos "Inactividad" (además del escaneo de cada 10 minutos). */
export const workflowInactividadRevisar = eventType("workflow/inactividad.revisar", {
  schema: staticSchema<Record<string, never>>(),
});

// Difusión: el contrato vive en `lib/difusion/eventos.ts` (lo emiten el panel
// y `programar_difusion()` por el outbox); acá sólo se registra para el motor.
export const difusionProgramada = eventType(EVENTO_DIFUSION_PROGRAMADA, {
  schema: staticSchema<DifusionProgramada>(),
});

export const difusionReanudada = eventType(EVENTO_DIFUSION_REANUDADA, {
  schema: staticSchema<DifusionReanudada>(),
});
