import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { UUIDSchema } from "@/lib/validation/schemas";

/**
 * El evento que avisa que una difusión quedó programada. Lo consume el motor
 * que drena la cola, que todavía no existe: este archivo es el contrato entre
 * los dos lados, y por eso vive en `lib/` y no en `src/inngest/events.ts` —lo
 * importan el panel (que lo emite), la base (que lo escribe en el outbox con la
 * misma forma) y el motor (que lo va a registrar con `eventType`).
 *
 * Lo produce `programar_difusion()` dos veces, a propósito:
 *   1. en la misma transacción que escribe el plan, como fila de `event_outbox`
 *      —el cron `dispatch-outbox-events` lo reenvía si todo lo demás falla—;
 *   2. directo desde el panel con `inngest.send`, para no esperar al cron.
 * Los dos llevan el mismo `id`, así que Inngest los deduplica.
 *
 * Los datos son los mínimos: el motor lee todo lo demás de la base, que es la
 * fuente de verdad. Las dos cifras viajan para que el motor pueda comprobar,
 * antes de la primera llamada a Meta, que el plan persistido es el que se
 * programó (la invariante M ≤ N del PRD §7.4).
 */

export const EVENTO_DIFUSION_PROGRAMADA = "difusion/programada";

export const DifusionProgramadaSchema = z
  .strictObject({
    difusionId: UUIDSchema,
    /**
     * Instante UTC con milisegundos, la forma de `Date.toISOString()` y de
     * `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` en la base.
     */
    programadaPara: z.iso.datetime({ precision: 3 }),
    /** Filas del plan: destinatarios más excluidos. */
    audienciaInicial: z.number().int().min(1),
    /** Filas que nacieron en cola. */
    destinatarios: z.number().int().min(0),
  })
  .refine((e) => e.destinatarios <= e.audienciaInicial, {
    message: "los destinatarios no pueden superar la audiencia inicial",
    path: ["destinatarios"],
  });

export type DifusionProgramada = z.infer<typeof DifusionProgramadaSchema>;

/**
 * Idempotency key del evento. Una difusión se programa una sola vez (de
 * borrador a programada no hay vuelta), así que el id de la difusión alcanza.
 */
export function idEventoDifusionProgramada(difusionId: string): string {
  return `difusion-programada:${difusionId}`;
}

export function eventoDifusionProgramada(input: {
  difusionId: string;
  programadaPara: Date;
  audienciaInicial: number;
  destinatarios: number;
}): { name: typeof EVENTO_DIFUSION_PROGRAMADA; id: string; data: DifusionProgramada } {
  const r = DifusionProgramadaSchema.safeParse({
    ...input,
    programadaPara: input.programadaPara.toISOString(),
  });
  if (!r.success) {
    throw new ValidationError(
      "el evento difusion/programada no cumple su contrato",
      r.error.issues,
    );
  }
  return {
    name: EVENTO_DIFUSION_PROGRAMADA,
    id: idEventoDifusionProgramada(r.data.difusionId),
    data: r.data,
  };
}
