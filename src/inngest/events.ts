import { eventType, staticSchema } from "inngest";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import type { IntentClassification } from "@/lib/validation/ai";
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
    };
  }>(),
});

// `mensajeOrigenId` es el entrante que disparó el turno: el Twin lo anota en la
// procedencia de cada campo para poder decir de qué mensaje salió el dato.
// Opcional porque los eventos ya encolados con la forma vieja tienen que seguir
// procesándose.
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
