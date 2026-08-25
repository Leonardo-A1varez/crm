import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { operationalReceived } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { MetaOperationalEventsRepository } from "@/server/repositories/meta-operational-events.repo";

export interface OnOperationalReceivedDeps {
  eventos: MetaOperationalEventsRepository;
  logger?: Logger;
}

export interface OnOperationalReceivedInput {
  campo: string;
  evento: string | null;
  objeto_id: string | null;
  objeto_nombre: string | null;
  payload: Record<string, unknown>;
  /** ISO. Una `Date` no sobrevive la serialización del evento. */
  ocurrido_at: string | null;
}

/**
 * Campos que significan que algo se rompió o está por romperse, y por eso se
 * loguean en `warn` en vez de `info`.
 *
 * No es un allowlist de qué se persiste —eso es todo— sino de qué merece que
 * alguien lo mire. Un `THROUGHPUT_UPGRADE` es una buena noticia; una plantilla
 * rechazada frena una campaña.
 */
const EVENTOS_QUE_DUELEN = new Set(["REJECTED", "DISABLED", "FLAGGED", "PAUSED", "LOCKED"]);

export async function operationalReceivedHandler(
  input: OnOperationalReceivedInput,
  deps: OnOperationalReceivedDeps,
): Promise<{ id: string }> {
  const logger = deps.logger ?? new NoopLogger();

  const fila = await deps.eventos.registrar({
    campo: input.campo,
    evento: input.evento,
    objeto_id: input.objeto_id,
    objeto_nombre: input.objeto_nombre,
    payload: input.payload,
    ocurrido_at: input.ocurrido_at === null ? null : new Date(input.ocurrido_at),
  });

  // Sin PII: estos eventos son sobre la cuenta y sus plantillas, nunca sobre
  // un lead, así que `campo`/`evento`/`objeto_nombre` no llevan datos de una
  // persona. El payload crudo queda en la tabla, no en el log.
  const contexto = {
    campo: input.campo,
    evento: input.evento,
    objeto: input.objeto_nombre ?? input.objeto_id,
  };
  if (input.evento !== null && EVENTOS_QUE_DUELEN.has(input.evento)) {
    logger.warn("meta.operational.atencion", contexto);
  } else {
    logger.info("meta.operational.registrado", contexto);
  }

  return { id: fila.id };
}

export function makeOnOperationalReceivedFn(deps: OnOperationalReceivedDeps) {
  return inngest.createFunction(
    {
      id: "on-operational-received",
      triggers: [{ event: operationalReceived }],
    },
    async ({ event, step }) => {
      const d = event.data;
      // Idempotencia explícita (AGENTS.md §10): el mismo evento reentregado
      // por Inngest no debe duplicar la fila. `ocurrido_at` + campo + objeto
      // identifican el evento; si Meta no manda `time`, se cae al id del
      // evento de Inngest, que es estable por entrega.
      const clave = `operational-${d.campo}-${d.objeto_id ?? "sin-objeto"}-${d.ocurrido_at ?? event.id}`;
      return step.run(clave, async () => {
        try {
          return await operationalReceivedHandler(d, deps);
        } catch (error) {
          if (isNonRetriable(error)) {
            throw new NonRetriableError((error as Error).message, { cause: error });
          }
          throw error;
        }
      });
    },
  );
}
