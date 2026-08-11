import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { recordatorioProgramado } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { SessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";
import type { UUID } from "@/types/entities";

/**
 * La puerta del saliente automático, cerrada.
 *
 * Si algún día el dueño decide que al vencer un recordatorio se le mande solo
 * un mensaje al cliente, se implementa esto y se inyecta en `bootstrap.ts`.
 * Hoy NO se inyecta, y ese es el default deliberado:
 *
 *   1. El dueño no pidió el envío automático ni respondió si lo quiere. Un
 *      saliente a un cliente real es de las cosas que salen caras si el default
 *      está mal, y no se elige por omisión.
 *   2. A las 48 h la ventana de 24 h de WhatsApp está cerrada: un texto libre
 *      lo rechaza Meta, y lo único que pasa es una plantilla aprobada.
 *   3. Para mandar plantillas ya existe `reactivation-predictor.cron` con su
 *      cooldown y su audit en `reactivation_dispatches`. Un segundo camino de
 *      salientes sin ese cooldown es cómo se llega a spam-block de Meta.
 *
 * Está tipado y el handler lo llama si está: eso hace que prenderlo sea wirear
 * una dependencia, y no reescribir el workflow.
 */
export type AvisarAlClienteFn = (input: {
  recordatorioId: UUID;
  leadSessionId: UUID;
}) => Promise<void>;

export interface RecordatorioSeguimientoDeps {
  recordatorios: SessionRecordatoriosRepository;
  /** Ver `AvisarAlClienteFn`. Sin inyectar = el recordatorio no le habla al cliente. */
  avisarAlCliente?: AvisarAlClienteFn;
  logger?: Logger;
}

export interface RecordatorioSeguimientoInput {
  recordatorioId: UUID;
  leadSessionId: UUID;
  /**
   * La fecha con la que ESTA ejecución se durmió. Es lo que la distingue de una
   * ejecución posterior sobre el mismo recordatorio: si el vendedor lo
   * reprogramó, la fila ya no tiene esta fecha y este despertar no avisa nada.
   */
  recordarAt: Date;
}

export interface RecordatorioSeguimientoResult {
  /**
   * `avisado` = la fila pasó a `avisado` y la conversación ya sube en el Inbox.
   * `sin-efecto` = el recordatorio se canceló mientras el workflow dormía (a
   * mano o porque el cliente escribió), lo reprogramaron para otra fecha —y
   * entonces avisa la ejecución nueva, no ésta—, o la sesión se purgó. No es un
   * error en ninguno de los tres casos.
   */
  resultado: "avisado" | "sin-efecto";
  /** Siempre `false` mientras la puerta del saliente siga cerrada. */
  mensajeAlCliente: boolean;
}

/**
 * Qué pasa cuando el recordatorio se despierta.
 *
 * Todo el trabajo es marcar la fila. El aviso al vendedor no es una
 * notificación aparte: `estado = 'avisado'` es lo que hace que `lib/triage` le
 * ponga el motivo `seguimiento` a la sesión, y con eso la conversación sube al
 * grupo "Requieren tu atención" del Inbox con su chip. Reusa el mismo mecanismo
 * que `humano`, `bloqueo` y `pago` en vez de inventar un canal propio.
 *
 * `marcarAvisado` devuelve `null` cuando la fila ya no estaba pendiente, así
 * que un replay del step —o un recordatorio cancelado mientras dormía— sale por
 * `sin-efecto` sin escribir nada. Ahí está la idempotencia real; el nombre del
 * step solo la memoiza dentro de una misma corrida.
 *
 * La segunda guarda es `esperadoRecordarAt`. Reprogramar deja la fila
 * `pendiente` —no cancelada— con otra fecha, así que el estado solo no alcanza:
 * esta ejecución se despertaría a la hora vieja y avisaría antes de tiempo. Al
 * pedir que la fecha de la fila sea todavía la que traía el evento, el aviso lo
 * da una sola ejecución, la que arrancó con la fecha que está guardada.
 */
export async function recordatorioSeguimientoHandler(
  input: RecordatorioSeguimientoInput,
  deps: RecordatorioSeguimientoDeps,
): Promise<RecordatorioSeguimientoResult> {
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "recordatorio-seguimiento",
    // Solo ids. La nota del recordatorio puede tener datos del cliente y no se
    // loguea en ningún nivel.
    recordatorio_id: input.recordatorioId,
  });

  const avisado = await deps.recordatorios.marcarAvisado(input.recordatorioId, {
    esperadoRecordarAt: input.recordarAt,
  });
  if (avisado === null) {
    logger.info("recordatorio-sin-efecto");
    return { resultado: "sin-efecto", mensajeAlCliente: false };
  }

  let mensajeAlCliente = false;
  if (deps.avisarAlCliente) {
    await deps.avisarAlCliente({
      recordatorioId: input.recordatorioId,
      leadSessionId: input.leadSessionId,
    });
    mensajeAlCliente = true;
  }

  logger.info("recordatorio-avisado", { mensaje_al_cliente: mensajeAlCliente });
  return { resultado: "avisado", mensajeAlCliente };
}

export function makeRecordatorioSeguimientoFn(deps: RecordatorioSeguimientoDeps) {
  return inngest.createFunction(
    {
      id: "recordatorio-seguimiento",
      triggers: [{ event: recordatorioProgramado }],
    },
    async ({ event, step }) => {
      const { recordatorioId, leadSessionId, recordarAt } = event.data;
      const fecha = new Date(recordarAt);

      // `sleepUntil` y no un cron que barre la tabla buscando vencidos: el
      // workflow durable ya sabe esperar dos días sin que nadie pague por
      // consultar cada minuto, y cada recordatorio es su propia ejecución que
      // se puede mirar en el dashboard de Inngest.
      await step.sleepUntil("esperar-la-fecha", fecha);

      // Idempotency key explícita (AGENTS.md §0.10): fecha + id del
      // recordatorio en el nombre del step, no autogenerado. Un replay de esta
      // ejecución reusa el resultado memoizado en vez de volver a marcar la
      // fila. La fecha va adelante siguiendo el patrón de la regla, y además
      // hace legible en el dashboard cuál de las citas de un recordatorio
      // reprogramado es esta ejecución.
      return step.run(`avisar-${recordarAt.slice(0, 10)}-${recordatorioId}`, async () => {
        try {
          return await recordatorioSeguimientoHandler(
            { recordatorioId, leadSessionId, recordarAt: fecha },
            deps,
          );
        } catch (e) {
          if (isNonRetriable(e)) {
            throw new NonRetriableError((e as Error).message, { cause: e });
          }
          throw e;
        }
      });
    },
  );
}
