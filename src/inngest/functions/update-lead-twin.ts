import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { turnCompleted } from "@/inngest/events";
import type { DisparoWorkflow } from "@/inngest/functions/workflow-disparar";
import { isNonRetriable } from "@/lib/errors";
import { contextoDeDisparo } from "@/lib/workflows/contexto";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { TwinExtractorService } from "@/server/services/twin-extractor.service";
import type { DelegacionDelTurno, TurnoDelegacion } from "@/lib/workflows/delegacion";
import type { LeadSession, UUID } from "@/types/entities";

export interface UpdateLeadTwinDeps {
  twinExtractor: TwinExtractorService;
  /** La etapa de antes de extraer: sin ella no se sabe si esta extracción la movió. */
  sessions: Pick<LeadSessionRepository, "findById">;
  /**
   * Manda `workflow/disparo.recibido`. Obligatoria a propósito: con un default
   * no-op, los flujos con trigger "Etapa cambiada" quedarían muertos sin que
   * falle nada — que es exactamente cómo estuvieron hasta la Fase 0.
   */
  emitirDisparo: (disparo: DisparoWorkflow) => Promise<void>;
  /**
   * Manda `workflow/delegacion.turno` a los tramos delegados al agente de este
   * turno. Opcional: sin él ningún tramo se entera de los turnos y todos
   * vuelven por vencimiento.
   */
  emitirAvisoTramo?: (aviso: AvisoTramo) => Promise<void>;
}

/** El aviso del turno a los tramos delegados, con el Twin ya escrito. */
export interface AvisoTramo {
  id: string;
  data: TurnoDelegacion & { leadId: UUID };
}

export interface UpdateLeadTwinInput {
  leadSessionId: UUID;
  conversationTurn: string[];
  mensajeOrigenId?: UUID | null;
  /**
   * Id del evento de Inngest. Arma el id del disparo cuando el evento no trae
   * mensaje de origen (los encolados con la forma vieja).
   */
  claveEvento?: string;
  /** El turno de los tramos delegados al agente (lo trae `turn.completed`). */
  delegacion?: DelegacionDelTurno;
}

export interface UpdateLeadTwinResult {
  sesion: LeadSession;
  /** El disparo `etapa_cambiada` si esta extracción movió la etapa; `null` si no. */
  disparo: DisparoWorkflow | null;
  /**
   * El aviso del turno a los tramos delegados: sale DESPUÉS de extraer, así
   * "Un campo del Twin cumpla" ve el dato de este turno. `null` sin tramos.
   */
  avisoTramo: AvisoTramo | null;
}

/**
 * Corre el extractor y dice si movió la etapa. No emite: devuelve el disparo
 * para que la función lo mande en un step aparte — si mandar el evento falla,
 * el reintento repite sólo ese step y no la llamada al LLM, que ya quedó
 * memoizada.
 *
 * La etapa se compara antes/después y no se deduce del patch: el extractor
 * descarta la etapa si una persona la fijó a mano (`descartarCorregidosAMano`),
 * y lo único que importa es si la sesión quedó en otra etapa.
 */
export async function updateLeadTwinHandler(
  input: UpdateLeadTwinInput,
  deps: UpdateLeadTwinDeps,
): Promise<UpdateLeadTwinResult> {
  const antes = await deps.sessions.findById(input.leadSessionId);
  const sesion = await deps.twinExtractor.extract({
    sessionId: input.leadSessionId,
    conversationTurn: input.conversationTurn,
    mensajeOrigenId: input.mensajeOrigenId ?? null,
  });

  const origen = input.mensajeOrigenId ?? input.claveEvento ?? "sin-origen";
  const avisoTramo = avisoDelTurno(input, sesion.lead_id);

  if (!antes || antes.current_stage === sesion.current_stage) {
    return { sesion, disparo: null, avisoTramo };
  }

  return {
    sesion,
    avisoTramo,
    disparo: {
      id: `workflow-disparo:etapa:${sesion.id}:${sesion.current_stage}:${origen}`,
      data: {
        disparador: "etapa_cambiada",
        leadId: sesion.lead_id,
        leadSessionId: sesion.id,
        contexto: contextoDeDisparo({ sesion }),
        datos: { etapaAnterior: antes.current_stage, etapaNueva: sesion.current_stage },
      },
    },
  };
}

/** El aviso del turno a los tramos delegados, o `null` si el turno no tiene. */
export function avisoDelTurno(
  input: Pick<UpdateLeadTwinInput, "delegacion" | "mensajeOrigenId" | "claveEvento">,
  leadId: UUID,
): AvisoTramo | null {
  const d = input.delegacion;
  if (!d || d.runIds.length === 0) return null;
  const origen = input.mensajeOrigenId ?? input.claveEvento ?? "sin-origen";
  return {
    id: `delegacion-turno:${origen}`,
    data: {
      leadId,
      mensajeId: input.mensajeOrigenId ?? null,
      runIds: d.runIds,
      tipo: "turno",
      intentId: d.intentId,
      respondio: d.respondio,
    },
  };
}

export function makeUpdateLeadTwinFn(deps: UpdateLeadTwinDeps) {
  return inngest.createFunction(
    { id: "update-lead-twin", triggers: [{ event: turnCompleted }] },
    async ({ event, step }) => {
      const { leadSessionId } = event.data;
      const extraer = () =>
        step.run("extract", async () => {
          try {
            return await updateLeadTwinHandler(
              {
                leadSessionId,
                conversationTurn: event.data.conversationTurn,
                mensajeOrigenId: event.data.mensajeOrigenId ?? null,
                claveEvento: event.id,
                delegacion: event.data.delegacion,
              },
              deps,
            );
          } catch (e) {
            if (isNonRetriable(e)) {
              throw new NonRetriableError((e as Error).message, { cause: e });
            }
            throw e;
          }
        });
      // El turno pasó aunque el extractor haya fallado: los tramos delegados se
      // enteran igual (abajo) y después se propaga el error.
      const extraccion = await extraer().then(
        (r) => ({ ok: true as const, r }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const resultado = extraccion.ok ? extraccion.r : null;

      const disparo = resultado?.disparo ?? null;
      if (disparo) {
        await step.run(`emit-workflow-etapa-${leadSessionId}`, () => deps.emitirDisparo(disparo));
      }
      const emitirAviso = deps.emitirAvisoTramo;
      if (emitirAviso && event.data.delegacion) {
        const aviso =
          resultado?.avisoTramo ??
          (await step.run(`aviso-delegacion-sin-extraccion-${leadSessionId}`, async () => {
            const sesion = await deps.sessions.findById(leadSessionId);
            return sesion
              ? avisoDelTurno(
                  {
                    delegacion: event.data.delegacion,
                    mensajeOrigenId: event.data.mensajeOrigenId ?? null,
                    claveEvento: event.id,
                  },
                  sesion.lead_id,
                )
              : null;
          }));
        if (aviso) {
          await step.run(`emit-delegacion-turno-${leadSessionId}`, () => emitirAviso(aviso));
        }
      }
      if (!extraccion.ok) throw extraccion.error;
      return extraccion.r.sesion;
    },
  );
}
