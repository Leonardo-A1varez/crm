import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { turnCompleted } from "@/inngest/events";
import type { DisparoWorkflow } from "@/inngest/functions/workflow-disparar";
import { isNonRetriable } from "@/lib/errors";
import { contextoDeDisparo } from "@/lib/workflows/contexto";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { TwinExtractorService } from "@/server/services/twin-extractor.service";
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
}

export interface UpdateLeadTwinResult {
  sesion: LeadSession;
  /** El disparo `etapa_cambiada` si esta extracción movió la etapa; `null` si no. */
  disparo: DisparoWorkflow | null;
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

  if (!antes || antes.current_stage === sesion.current_stage) {
    return { sesion, disparo: null };
  }

  const origen = input.mensajeOrigenId ?? input.claveEvento ?? "sin-origen";
  return {
    sesion,
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

export function makeUpdateLeadTwinFn(deps: UpdateLeadTwinDeps) {
  return inngest.createFunction(
    { id: "update-lead-twin", triggers: [{ event: turnCompleted }] },
    async ({ event, step }) => {
      const { leadSessionId } = event.data;
      const resultado = await step.run("extract", async () => {
        try {
          return await updateLeadTwinHandler(
            {
              leadSessionId,
              conversationTurn: event.data.conversationTurn,
              mensajeOrigenId: event.data.mensajeOrigenId ?? null,
              claveEvento: event.id,
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

      const disparo = resultado.disparo;
      if (disparo) {
        await step.run(`emit-workflow-etapa-${leadSessionId}`, () => deps.emitirDisparo(disparo));
      }
      return resultado.sesion;
    },
  );
}
