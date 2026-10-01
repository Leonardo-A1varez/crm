import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { copilotoBorradorSolicitado } from "@/inngest/events";
import { passthroughStep, type StepRunner } from "@/inngest/functions/on-message-received";
import { codigoDeErrorBorrador } from "@/lib/copiloto/errores";
import { resolverResultadoRegenerado } from "@/lib/copiloto/resultado";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { IntentClassification } from "@/lib/validation/ai";
import type { BorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { TurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import type { WorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import {
  buildConversationTurn,
  buildRespondInput,
} from "@/server/services/agente/conversation-turn";
import type { AiAgentService } from "@/server/services/ai-agent.service";
import type { IntentClassifierService } from "@/server/services/intent-classifier.service";
import type { UUID } from "@/types/entities";

export interface CopilotoBorradorDeps {
  borradores: Pick<BorradoresIaRepository, "findById" | "iniciar" | "completar" | "marcarError">;
  conversations: Pick<ConversationsRepository, "findById">;
  sessions: Pick<LeadSessionRepository, "findActiveByLeadId">;
  messages: Pick<MessagesRepository, "findById" | "listByConversacion">;
  turnClassifications: Pick<TurnClassificationsRepository, "findByMensajeId">;
  intentClassifier: IntentClassifierService;
  aiAgent: AiAgentService;
  configProvider: AgentConfigProvider;
  /**
   * Los tramos que un flujo le delegó al agente: sus instrucciones van al prompt
   * igual que en el pipeline. Opcional como en `OnMessageReceivedDeps`;
   * `bootstrap.ts` lo wirea.
   */
  delegaciones?: Pick<WorkflowRunsRepository, "delegacionesActivas">;
  logger?: Logger;
}

export interface CopilotoBorradorInput {
  borradorId: UUID;
  conversacionId: UUID;
}

export type ResultadoCopilotoBorrador = {
  estado: "listo" | "error" | "omitido";
  motivo?: string;
};

/**
 * Vuelve a redactar el borrador de una conversación con el contexto actual
 * (R4: `respond` solo corría dentro de `on-message-received`).
 *
 * Reconstruye lo que el pipeline le pasa a `respond`: el turno (últimos
 * mensajes + resumen), la clasificación del entrante y los tramos delegados,
 * armados con los mismos builders que usa el pipeline. La clasificación se
 * reusa de `turn_classifications` si el turno original la auditó; si no (lo
 * resolvió una regla, o falló antes), se vuelve a clasificar —es barato y queda
 * atribuido al mismo mensaje en `llm_usage`—.
 *
 * El texto del borrador nunca se loguea: los logs llevan ids, estados y códigos.
 */
export async function copilotoBorradorHandler(
  input: CopilotoBorradorInput,
  deps: CopilotoBorradorDeps,
  step: StepRunner = passthroughStep,
  idPaso: (paso: string) => string = (paso) => paso,
): Promise<ResultadoCopilotoBorrador> {
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "copiloto-borrador",
    borrador_id: input.borradorId,
  });

  const previo = await step.run(idPaso("cargar"), async () => {
    const b = await deps.borradores.findById(input.borradorId);
    if (!b) return { omitir: "borrador_inexistente" as const };
    if (b.conversacion_id !== input.conversacionId)
      return { omitir: "conversacion_distinta" as const };
    // Regenerar un borrador `usado` o `redactando` no tiene sentido: el primero ya se
    // envió y el segundo ya se está redactando.
    if (b.estado !== "listo" && b.estado !== "error")
      return { omitir: "borrador_no_vigente" as const };
    const conv = await deps.conversations.findById(b.conversacion_id);
    if (!conv) return { omitir: "conversacion_inexistente" as const };
    const sesion = await deps.sessions.findActiveByLeadId(conv.lead_id);
    if (!sesion || sesion.id !== b.lead_session_id) return { omitir: "sesion_cerrada" as const };
    return {
      omitir: null,
      leadId: conv.lead_id,
      leadSessionId: b.lead_session_id,
      mensajeOrigenId: b.mensaje_origen_id,
    };
  });
  if (previo.omitir !== null) {
    logger.info("copiloto-omitido", { motivo: previo.omitir });
    return { estado: "omitido", motivo: previo.omitir };
  }

  const nuevo = await step.run(idPaso("iniciar"), () =>
    deps.borradores.iniciar({
      conversacionId: input.conversacionId,
      leadSessionId: previo.leadSessionId,
      mensajeOrigenId: previo.mensajeOrigenId,
      forzar: true,
    }),
  );
  if (nuevo.resultado !== "creado") {
    logger.info("copiloto-omitido", { motivo: nuevo.resultado });
    return { estado: "omitido", motivo: nuevo.resultado };
  }
  const borradorId = nuevo.borradorId;

  try {
    const config = await step.run(idPaso("leer-config"), async () => {
      const c = await deps.configProvider.get();
      return {
        ventana_contexto_mensajes: c.ventana_contexto_mensajes,
        descuento_max_pct: c.descuento_max_pct,
      };
    });

    const tramos = await step.run(idPaso("leer-tramos"), async () =>
      deps.delegaciones ? deps.delegaciones.delegacionesActivas(previo.leadId, new Date()) : [],
    );

    const clasificacion = await step.run(
      idPaso("clasificar"),
      async (): Promise<IntentClassification> => {
        const auditada = await deps.turnClassifications.findByMensajeId(previo.mensajeOrigenId);
        if (auditada) {
          return { intent_nombre: auditada.intent_nombre, confidence: auditada.confidence };
        }
        const origen = await deps.messages.findById(previo.mensajeOrigenId);
        return deps.intentClassifier.classify(origen?.contenido ?? "", {
          mensajeId: previo.mensajeOrigenId,
          leadSessionId: previo.leadSessionId,
        });
      },
    );

    const turno = await step.run(idPaso("armar-turno"), async () => {
      const sesion = await deps.sessions.findActiveByLeadId(previo.leadId);
      return buildConversationTurn(
        input.conversacionId,
        deps.messages,
        sesion?.context_summary ?? null,
        config.ventana_contexto_mensajes,
      );
    });

    const respuesta = await step.run(idPaso("responder"), () =>
      deps.aiAgent.respond(
        buildRespondInput({
          leadSessionId: previo.leadSessionId,
          conversationTurn: turno,
          classification: clasificacion,
          mensajeOrigenId: previo.mensajeOrigenId,
          tramos,
          // Regenerar no tiene efectos: una escalada no pausa la sesión ni le
          // avisa al cliente, queda como error del borrador.
          soloRedactar: true,
        }),
      ),
    );

    const resultado = resolverResultadoRegenerado(respuesta, config.descuento_max_pct);
    if (resultado.tipo === "error") {
      const marcado = await step.run(
        idPaso("marcar-error"),
        async () => (await deps.borradores.marcarError(borradorId, resultado.codigo)) !== null,
      );
      if (!marcado) {
        logger.info("copiloto-omitido", { motivo: "obsoleto" });
        return { estado: "omitido", motivo: "obsoleto" };
      }
      logger.info("copiloto-borrador-error", { codigo: resultado.codigo });
      return { estado: "error", motivo: resultado.codigo };
    }

    const guardado = await step.run(idPaso("guardar"), async () => {
      const b = await deps.borradores.completar(borradorId, {
        contenido: resultado.contenido,
        origen: resultado.origen,
        reglaId: resultado.reglaId,
      });
      return b !== null;
    });
    // `null`: el borrador ya no estaba `redactando` (llegó otro mensaje y lo
    // descartó mientras se redactaba). No hay nada que ofrecer.
    if (!guardado) {
      logger.info("copiloto-omitido", { motivo: "obsoleto" });
      return { estado: "omitido", motivo: "obsoleto" };
    }
    logger.info("copiloto-borrador-listo", { origen: resultado.origen });
    return { estado: "listo" };
  } catch (error) {
    await step.run(idPaso("marcar-error-llm"), () =>
      deps.borradores.marcarError(borradorId, codigoDeErrorBorrador(error)),
    );
    logger.error("copiloto-borrador-fallo", {
      error_name: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}

function pasoDeInngest(step: {
  run: <U>(name: string, fn: () => Promise<U>) => Promise<unknown>;
}): StepRunner {
  return {
    run: <T>(name: string, fn: () => Promise<T>): Promise<T> => step.run(name, fn) as Promise<T>,
  };
}

export function makeCopilotoBorradorFn(deps: CopilotoBorradorDeps) {
  return inngest.createFunction(
    {
      id: "copiloto-borrador",
      // Dos pedidos sobre la misma conversación no corren a la vez; el lock del
      // RPC `iniciar_borrador_ia` cubre la carrera contra el pipeline.
      concurrency: { key: "event.data.conversacionId", limit: 1 },
      triggers: [{ event: copilotoBorradorSolicitado }],
    },
    async ({ event, step }) => {
      // Ids de step explícitos por pedido (AGENTS §0.10): el reintento de un
      // step no rehace lo que ya hizo, y dos pedidos no comparten memoización.
      const dia = new Date(event.ts).toISOString().slice(0, 10);
      try {
        return await copilotoBorradorHandler(
          event.data,
          deps,
          pasoDeInngest(step),
          (paso) => `copiloto-borrador-${dia}-${event.data.borradorId}-${paso}`,
        );
      } catch (e) {
        if (isNonRetriable(e)) {
          throw new NonRetriableError((e as Error).message, { cause: e });
        }
        throw e;
      }
    },
  );
}
