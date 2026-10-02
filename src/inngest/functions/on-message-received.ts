import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { messageReceived } from "@/inngest/events";
import { IllegalStateError, isNonRetriable, ValidationError } from "@/lib/errors";
import { horarioSinRangos } from "@/lib/agente/defaults";
import { excedeDescuento } from "@/lib/agente/descuento";
import {
  CONFIRMACION_BAJA,
  palabraDeBaja,
  type PalabraDeBaja,
} from "@/lib/difusion/baja-por-palabra";
import { estaAbierto } from "@/lib/agente/horario";
import { codigoDeErrorBorrador } from "@/lib/copiloto/errores";
import { decidirModo, equipoAbiertoAhora } from "@/lib/copiloto/modo";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import { contextoDeDisparo } from "@/lib/workflows/contexto";
import type { DispararWorkflowInput } from "@/inngest/functions/workflow-disparar";
import { claveSaliente } from "@/server/services/meta-api.service";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import type { IntentClassification } from "@/lib/validation/ai";
import type { BorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { DifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import type { IntentsRepository } from "@/server/repositories/intents.repo";
import {
  normalizarIdentificador,
  type LeadIdentificadoresRepository,
} from "@/server/repositories/lead-identificadores.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { RespuestaDifusionService } from "@/server/services/difusion/respuesta.service";
import type { AnotarPlantillasSinSesion } from "@/server/services/workflows/plantilla-sin-sesion.service";
import type {
  DecisionIntercepcion,
  Intercepcion,
  InterceptorTurno,
} from "@/server/services/workflows/interceptor.service";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { RuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import {
  NoopSessionRecordatoriosRepository,
  type SessionRecordatoriosRepository,
} from "@/server/repositories/session-recordatorios.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { TurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import {
  buildConversationTurn,
  buildRespondInput,
  vehiculosParaAgente,
} from "@/server/services/agente/conversation-turn";
import type { LeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.repo";
import type { AgentTurnResult, AiAgentService } from "@/server/services/ai-agent.service";
import type { IntentClassifierService } from "@/server/services/intent-classifier.service";
import type { MetaApiService } from "@/server/services/meta-api.service";
import type { RuleEngineService } from "@/server/services/rule-engine.service";
import type { HandoffService } from "@/server/services/handoff.service";
import type {
  DelegacionActiva,
  WorkflowRunsRepository,
} from "@/server/repositories/workflow-runs.repo";
import type { DelegacionDelTurno, TurnoDelegacion } from "@/lib/workflows/delegacion";
import type { ModoDecidido } from "@/types/copiloto";
import type { Canal } from "@/types/domain";
import type { Lead, LeadSession, MetaUserIds, UUID } from "@/types/entities";

// La frase vive en `lib/difusion/baja-por-palabra.ts`; se re-exporta para los
// tests del pipeline.
export { CONFIRMACION_BAJA };

export type EmittedEvent =
  | {
      name: "lead-session/turn.completed";
      data: {
        leadSessionId: UUID;
        conversationTurn: string[];
        mensajeOrigenId?: UUID;
        /**
         * El turno de los tramos delegados al agente: el extractor se lo avisa
         * cuando termina (`update-lead-twin`), con el Twin ya escrito.
         */
        delegacion?: DelegacionDelTurno;
      };
    }
  | {
      name: "lead-session/auto-handoff.evaluate";
      data: {
        leadSessionId: UUID;
        recentClassifications: IntentClassification[];
        threshold?: number;
      };
    }
  | {
      name: "lead/created";
      data: { leadId: UUID; canal: Canal };
    }
  | {
      name: "workflow/disparo.recibido";
      data: DispararWorkflowInput;
      /** Deduplicación de Inngest: la reentrega del step no arranca dos corridas. */
      id: string;
    }
  | {
      name: "workflow/respuesta.interactiva";
      data: { leadId: UUID; respondeA: string | null; opcionId: string; titulo: string };
      /** Deduplicación de Inngest: `respuesta-interactiva:<wamid del entrante>`. */
      id: string;
    }
  | {
      name: "workflow/delegacion.turno";
      data: TurnoDelegacion & { leadId: UUID };
      /** Deduplicación de Inngest: `delegacion-<tipo>:<entrante>`. */
      id: string;
    };

export interface OnMessageReceivedDeps {
  leads: LeadsRepository;
  conversations: ConversationsRepository;
  sessions: LeadSessionRepository;
  messages: MessagesRepository;
  metaApi: MetaApiService;
  intentClassifier: IntentClassifierService;
  aiAgent: AiAgentService;
  handoff?: HandoffService;
  ruleExecutions: RuleExecutionsRepository;
  turnClassifications: TurnClassificationsRepository;
  /**
   * Qué etiquetas manda colgar el intent de este turno. Es el mismo motor que
   * elige la respuesta enlatada, con su otro método.
   */
  ruleEngine: RuleEngineService;
  /**
   * Dónde se cuelgan esas etiquetas. Obligatoria a propósito, igual que
   * `identificadores`: con un default no-op, un caller que la olvide deja el
   * etiquetado automático muerto sin que falle nada.
   */
  tags: TagsRepository;
  /** Solo para resolver el intent clasificado a su id al auditar el turno. */
  intents: IntentsRepository;
  /**
   * Dónde queda el teléfono del lead nuevo. Es lo que lo hace visible para el
   * detector de duplicados, que busca por identidad compartida y no mira
   * `leads.telefono`. Obligatoria a propósito: con default, un caller que la
   * olvide reproduce en silencio el bug que esta dependencia arregla.
   */
  identificadores: LeadIdentificadoresRepository;
  /**
   * Dónde queda la baja propia de quien escribe "BAJA", "SALIR", "PARAR" o
   * "SAIR" solos (`palabraDeBaja`). Obligatoria por el mismo motivo que
   * `identificadores`: con un default no-op, un caller que la olvide deja de
   * registrar bajas sin que falle nada, y una baja perdida es marketing a
   * alguien que pidió no recibirlo.
   */
  supresiones: Pick<DifusionSupresionesRepository, "registrar" | "activasPorTelefonos">;
  /**
   * Si el entrante responde a una difusión, anota la plantilla en el hilo y en
   * la sesión (`services/difusion/respuesta.service.ts`). Obligatoria: sin ella
   * el vendedor no ve qué se le mandó al cliente y el agente contesta sin
   * saber a qué responde.
   */
  respuestaDifusion: Pick<RespuestaDifusionService, "registrar">;
  /**
   * Las plantillas que un flujo le mandó al lead sin sesión ("Reactivar
   * perdidos") entran al hilo cuando responde
   * (`services/workflows/plantilla-sin-sesion.service.ts`). Obligatoria por lo
   * mismo que `respuestaDifusion`.
   */
  plantillasSinSesion: Pick<AnotarPlantillasSinSesion, "registrar">;
  /**
   * Decide si este turno lo contesta un flujo en lugar del agente
   * (`services/workflows/interceptor.service.ts`): un flujo "intercepta el
   * LLM" cuya condición se cumple, o el toque de un botón que una corrida
   * espera. Opcional: sin él contesta siempre el agente, que es el
   * comportamiento de antes; `bootstrap.ts` lo wirea.
   */
  interceptor?: InterceptorTurno;
  /**
   * Los tramos que un flujo le delegó al agente ("Delegar al agente",
   * `lib/workflows/delegacion.ts`): sus instrucciones van al prompt y cada
   * turno se les avisa con `workflow/delegacion.turno`. Opcional: sin él el
   * agente contesta como siempre y ningún tramo se entera; `bootstrap.ts` lo
   * wirea.
   */
  delegaciones?: Pick<WorkflowRunsRepository, "delegacionesActivas">;
  /**
   * Los autos guardados del lead: van al contexto del agente para que busque
   * con el vehículo real y no adivine el año. Opcional: sin él el agente recibe
   * una lista vacía, como antes; `bootstrap.ts` lo wirea.
   */
  vehiculos?: Pick<LeadVehiculosRepository, "listByLeadId">;
  /**
   * Para apagar el seguimiento cuando el cliente vuelve solo. Opcional con
   * default Noop —mismo criterio que `dispatches` en el cron de reactivación—
   * para que los callers viejos sigan compilando; `bootstrap.ts` lo wirea.
   */
  recordatorios?: SessionRecordatoriosRepository;
  cancelarAvisoRecordatorio?: (input: { recordatorioId: UUID; recordarAt: Date }) => Promise<void>;
  /**
   * Dónde se guardan los borradores del copiloto (`borradores_ia`). Opcional
   * para que los callers que no usan el copiloto sigan compilando, pero con el
   * modo decidido en Copiloto y sin él el turno **falla en voz alta**
   * (`exigirBorradores`): el fallback silencioso sería mandar por la API lo que
   * el equipo pidió redactar. `bootstrap.ts` lo wirea.
   */
  borradores?: Pick<
    BorradoresIaRepository,
    "iniciar" | "completar" | "marcarError" | "descartar" | "descartarVigentes"
  >;
  configProvider: AgentConfigProvider;
  emit: (event: EmittedEvent) => Promise<void>;
  logger?: Logger;
}

export interface OnMessageReceivedInput {
  parsed: ParsedMessage;
}

export interface OnMessageReceivedResult {
  leadId: UUID;
  leadCreated: boolean;
  sessionId: UUID;
  sessionCreated: boolean;
  conversacionId: UUID;
  /**
   * `baja`: el mensaje era una palabra de baja registrable y el turno cortó
   * antes del agente (ver `ResultadoBaja`).
   * `flujo`: lo contesta un flujo en lugar del agente (ver `interceptor`).
   */
  agentSource: "rule" | "llm" | "handoff" | "baja" | "flujo";
  sent: boolean;
  duplicate: boolean;
}

// Permite memoización granular por Inngest. En tests usar passthroughStep.
export interface StepRunner {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export const passthroughStep: StepRunner = {
  run: (_name, fn) => fn(),
};

export async function onMessageReceivedHandler(
  input: OnMessageReceivedInput,
  deps: OnMessageReceivedDeps,
  step: StepRunner = passthroughStep,
): Promise<OnMessageReceivedResult> {
  const { parsed } = input;
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "on-message-received",
    canal: parsed.canal,
    meta_message_id: parsed.meta_message_id,
  });

  logger.info("pipeline-start");

  // Si el turno falla después de leer los tramos delegados, se les avisa por
  // «Error» antes de propagar (ver el `catch`).
  let avisarErrorAlTramo: (() => Promise<void>) | null = null;

  try {
    const isDuplicate = await step.run("dedup", async () => {
      const existing = await deps.messages.findByMetaMessageId(parsed.meta_message_id);
      return existing !== null;
    });
    if (isDuplicate) logger.info("dedup-hit");

    const { lead, created: leadCreated } = await step.run("resolve-lead", () =>
      resolveLead(parsed, deps.leads),
    );
    if (leadCreated) {
      logger.info("lead-created", { lead_id: lead.id });
      // Solo WhatsApp. IG y Messenger no exponen número y `buildPlaceholderLead`
      // les guarda `ig:12345` para poder llenar la columna: si ese relleno
      // entrara, dos leads de Instagram sin número real se propondrían como
      // duplicados entre sí por un valor que solo significa "no sabemos el
      // número". Misma exclusión que el backfill y el merge
      // (`supabase/migrations/20260814180000`).
      //
      // Va ANTES de `emit-lead-created`: ese evento dispara
      // `detect-merge-candidates-per-lead`, que busca por identificador
      // compartido. Con la fila escrita después, el lead recién creado no
      // coincide con nada y la detección per-lead queda dependiendo del cron
      // global de las 5 AM.
      if (parsed.canal === "wa") {
        await step.run("crear-identificador", () =>
          registrarTelefono(lead, deps.identificadores, logger),
        );
      }
      await step.run("emit-lead-created", () =>
        deps.emit({
          name: "lead/created",
          data: { leadId: lead.id, canal: parsed.canal },
        }),
      );
    }

    const conv = await step.run("upsert-conv", () =>
      deps.conversations.upsertByCanalThread(parsed.canal, parsed.canal_thread_id, lead.id),
    );

    const { session, created: sessionCreated } = await step.run("resolve-session", () =>
      resolveActiveSession(lead.id, deps.sessions),
    );
    if (sessionCreated) logger.info("session-created", { session_id: session.id });

    // La difusión salió por el motor, sin sesión: si este mensaje le responde,
    // la plantilla se anota ahora en esta sesión, con la hora en que salió, así
    // queda antes del entrante en el hilo y en el turno del agente. Sólo por
    // WhatsApp: es el único canal por el que sale una difusión.
    let respondida: Awaited<ReturnType<RespuestaDifusionService["registrar"]>> = null;
    if (parsed.canal === "wa") {
      respondida = await step.run("registrar-respuesta-difusion", () =>
        deps.respuestaDifusion.registrar({
          leadId: lead.id,
          conversacionId: conv.id,
          leadSessionId: session.id,
          ahora: parsed.platform_created_at ?? new Date(),
          entranteMetaMessageId: parsed.meta_message_id,
        }),
      );
      if (respondida) logger.info("difusion-respondida", { difusion_id: respondida.difusionId });
      // Lo mismo con las plantillas que un flujo mandó sin sesión.
      const anotadas = await step.run("registrar-plantillas-sin-sesion", () =>
        deps.plantillasSinSesion.registrar({
          leadId: lead.id,
          conversacionId: conv.id,
          leadSessionId: session.id,
          ahora: parsed.platform_created_at ?? new Date(),
        }),
      );
      if (anotadas > 0) logger.info("plantillas-de-flujo-anotadas", { cantidad: anotadas });
    }

    const inbound = await step.run("record-inbound", () =>
      deps.metaApi.recordInbound({
        conversacionId: conv.id,
        leadSessionId: session.id,
        parsed,
      }),
    );

    // El cliente escribió: el seguimiento que alguien se puso sobre esta
    // conversación deja de tener sentido. Un recordatorio es "se quedó
    // callado", y este mensaje es la prueba de que no.
    //
    // Va acá arriba, pegado al entrante y antes de todas las salidas tempranas
    // —duplicado, fuera de horario, descuento excedido—: un mensaje del cliente
    // a las 3 de la mañana cancela igual, aunque el agente no lo conteste
    // hasta que abra. Cancelar de más no rompe nada; no cancelar deja al
    // vendedor persiguiendo a alguien que ya respondió.
    const recordatorios = deps.recordatorios ?? new NoopSessionRecordatoriosRepository();
    const recordatorioVivo = await recordatorios.findVivoBySessionId(session.id);
    const cancelados = await step.run("cancelar-recordatorios", () =>
      recordatorios.cancelarVivosDeSesion(session.id, "respondio"),
    );
    if (cancelados > 0 && recordatorioVivo && deps.cancelarAvisoRecordatorio) {
      await step.run("cancelar-workflow-recordatorio", () =>
        deps.cancelarAvisoRecordatorio!({
          recordatorioId: recordatorioVivo.id,
          recordarAt: recordatorioVivo.recordar_at,
        }),
      );
    }
    // Solo la cuenta: la nota del recordatorio puede tener datos del cliente.
    if (cancelados > 0) logger.info("recordatorios-cancelados", { cantidad: cancelados });

    if (isDuplicate) {
      logger.info("pipeline-complete", { duplicate: true, sent: false });
      return {
        leadId: lead.id,
        leadCreated,
        sessionId: session.id,
        sessionCreated,
        conversacionId: conv.id,
        agentSource: "handoff",
        sent: false,
        duplicate: true,
      };
    }

    // Un entrante nuevo deja viejo el borrador que estaba vigente: ofrecerlo
    // después de que llegó otro mensaje sería contestar la pregunta anterior.
    // Va acá y no junto a `iniciar-borrador` porque hay turnos que nunca llegan a
    // redactar (baja, flujo interceptor, fuera de horario) y el borrador previo
    // igual quedó obsoleto.
    //
    // Si falla (el código llegó antes que la migración de `borradores_ia`, o la
    // base tuvo un hipo) NO tumba el turno: este step corre en cada entrante de
    // todos los canales, y con el copiloto apagado o fuera de turno el fallo
    // callaría a quien escribe sin que el copiloto tenga nada que ver. Se avisa
    // y se sigue; si el modo que se decide más abajo es Copiloto, `decidir-modo`
    // repite la invalidación y ahí sí falla en voz alta.
    let invalidacionFallo = false;
    if (deps.borradores) {
      const borradores = deps.borradores;
      invalidacionFallo = await step.run("invalidar-borrador-previo", async () => {
        try {
          await borradores.descartarVigentes(conv.id);
          return false;
        } catch (error) {
          logger.warn("borrador.invalidar_previo_fallo", {
            conversacion_id: conv.id,
            error_name: error instanceof Error ? error.name : "desconocido",
          });
          return true;
        }
      });
    }

    // El lead tocó un botón o eligió una fila de una lista: el flujo que
    // mandó ese mensaje la está esperando (`workflow-segmento`). Va antes de
    // la baja, del horario y del agente, como los disparos: la opción cuenta
    // aunque el agente no conteste. Ya está en el hilo (`record-inbound`), que
    // es donde la busca la espera si vence en el hueco.
    const respuestaInteractiva = parsed.respuesta_interactiva;
    if (respuestaInteractiva) {
      await step.run("emit-respuesta-interactiva", () =>
        deps.emit({
          name: "workflow/respuesta.interactiva",
          id: `respuesta-interactiva:${parsed.meta_message_id}`,
          data: {
            leadId: lead.id,
            respondeA: respuestaInteractiva.responde_a,
            opcionId: respuestaInteractiva.id,
            titulo: respuestaInteractiva.titulo,
          },
        }),
      );
    }

    // Baja propia: el mensaje es "BAJA", "SALIR", "PARAR" o "SAIR" solos. Va
    // antes de avisarle a los flujos —ninguno tiene que poder reaccionar a este
    // mensaje sin que la baja ya esté escrita— y antes del horario: una baja a
    // las 3 de la mañana cuenta igual. Sólo texto: el pie de foto de un
    // adjunto no es alguien escribiendo "BAJA".
    //
    // Una baja nueva se confirma con `CONFIRMACION_BAJA` (decisión del dueño),
    // en un step aparte: si mandar falla, el reintento no vuelve a registrar.
    // La clave `baja:<entrante>` hace que un reintento de ese step no la mande
    // dos veces, y no choca con la de la respuesta del agente (`out:`).
    //
    // Con la baja registrada —nueva o repetida— el turno corta después de
    // avisarle a los flujos: ni clasificador ni agente (ver `ResultadoBaja`).
    const baja = parsed.tipo === "text" ? palabraDeBaja(parsed.contenido) : null;
    const resultadoBaja: ResultadoBaja | null =
      baja === null
        ? null
        : await step.run("registrar-baja", () =>
            registrarBaja(parsed, lead.id, baja, deps.supresiones, logger),
          );
    if (resultadoBaja === "nueva") {
      await step.run("confirmar-baja", () =>
        deps.metaApi.sendOutbound({
          conversacionId: conv.id,
          leadSessionId: session.id,
          canal: parsed.canal,
          to: parsed.meta_user_id,
          contenido: CONFIRMACION_BAJA,
          sender: "sistema",
          idempotencyKey: `baja:${parsed.meta_message_id}`,
        }),
      );
    }

    // Los flujos con trigger "Mensaje recibido" (Corte 3 de la Fase 0: el
    // evento tenía consumidor y ningún emisor). Va antes del horario, del
    // clasificador y del agente: el flujo decide qué hacer con el mensaje, no
    // lo que haya pasado con la respuesta de la IA — como el recordatorio de
    // arriba, un mensaje a las 3 de la mañana dispara igual. El duplicado ya
    // salió: la reentrega de Meta no dispara dos veces, y el `id` cubre la
    // reentrega de este step.
    // Los flujos con trigger "Lead creado". Acá y no junto a `emit-lead-created`
    // (que corre apenas nace el lead): recién ahora hay sesión, y un flujo de
    // bienvenida que mueve la etapa o escala la necesita. Va antes del disparo
    // del mensaje para que la bienvenida no dependa del orden en que Inngest
    // procese los dos. `leadCreated` viene memoizado del step `resolve-lead`,
    // así que el reintento de este turno no lo recalcula; el `id` cubre la
    // reentrega de este step y cualquier otra: un lead nace una sola vez.
    if (leadCreated) {
      await step.run("emit-workflow-lead-creado", () =>
        deps.emit({
          name: "workflow/disparo.recibido",
          id: `workflow-disparo:lead-creado:${lead.id}`,
          data: {
            disparador: "lead_creado",
            leadId: lead.id,
            leadSessionId: session.id,
            contexto: contextoDeDisparo({
              lead,
              sesion: session,
              canal: parsed.canal,
              respondio: true,
            }),
            datos: { canal: parsed.canal },
          },
        }),
      );
    }

    // El disparo "Mensaje recibido" lleva el intent de ESTE turno: la base
    // recién lo escribe cuando contesta el agente, así que una condición
    // "Intent detectado" que lo leyera de ahí vería el turno anterior. Por eso
    // sale después de clasificar —o, en los caminos que no clasifican (baja,
    // fuera de horario) o si la clasificación falla, con `null`: el turno no
    // tiene intent—. Nunca deja de salir por falta de intent.
    const datosMensaje = {
      canal: parsed.canal,
      tipoMensaje: parsed.tipo,
      texto: parsed.contenido,
    };
    const emitirMensajeRecibido = (intentNombre: string | null, interceptadoPor?: UUID) =>
      step.run("emit-workflow-mensaje", async () => {
        const intent = intentNombre !== null ? await deps.intents.findByNombre(intentNombre) : null;
        await deps.emit({
          name: "workflow/disparo.recibido",
          id: `workflow-disparo:mensaje:${inbound.id}`,
          data: {
            disparador: "mensaje_recibido",
            leadId: lead.id,
            leadSessionId: session.id,
            contexto: contextoDeDisparo({
              lead,
              sesion: session,
              canal: parsed.canal,
              respondio: true,
              intent: {
                id: intent?.id ?? null,
                mensajeAt: new Date(inbound.created_at).toISOString(),
              },
            }),
            datos: datosMensaje,
            ...(interceptadoPor !== undefined ? { interceptadoPor } : {}),
          },
        });
      });

    // Los flujos con trigger "Difusión respondida" (PRD §4.1, §7.6): sólo con
    // LA respuesta —el primer entrante después de la difusión—, no con cada
    // mensaje de la conversación que abrió. Va junto al de "Mensaje recibido"
    // y por la misma razón: el flujo decide, no lo que conteste la IA.
    if (respondida?.primera) {
      const r = respondida;
      await step.run("emit-workflow-difusion-respondida", () =>
        deps.emit({
          name: "workflow/disparo.recibido",
          id: `workflow-disparo:difusion-respondida:${r.envioId}:${parsed.meta_message_id}`,
          data: {
            disparador: "difusion_respondida",
            leadId: lead.id,
            leadSessionId: session.id,
            contexto: contextoDeDisparo({
              lead,
              sesion: session,
              canal: parsed.canal,
              respondio: true,
            }),
            datos: { canal: parsed.canal, difusionId: r.difusionId },
          },
        }),
      );
    }

    // Baja registrada: el turno termina acá (decisión del dueño). Quien acaba
    // de pedir que no le escriban recibe la confirmación y nada más; si ya
    // estaba dado de baja, ni eso. Los flujos ya se enteraron arriba, y los
    // que quieran contestarle chocan con los topes, que bloquean a quien está
    // en la lista. Tampoco se emite `turn.completed`: sin respuesta del agente
    // no hay turno que extraer al Twin, y extraerlo sería otra llamada al LLM.
    // "Delegar al agente": los tramos vivos del lead, y el aviso de cada turno.
    // `tipo` arma el id de deduplicación: un turno avisa una sola vez de cada
    // cosa, y el error no se come al turno si un reintento después sale bien.
    const leerTramos = (nombre: string) =>
      deps.delegaciones
        ? step.run(nombre, () => deps.delegaciones!.delegacionesActivas(lead.id, new Date()))
        : Promise.resolve([] as DelegacionActiva[]);
    const avisarTramo = (
      tramos: DelegacionActiva[],
      tipo: TurnoDelegacion["tipo"],
      intentNombre: string | null,
      respondio: boolean,
    ) =>
      tramos.length === 0
        ? Promise.resolve()
        : step.run(`emit-delegacion-${tipo}`, async () => {
            const intent =
              intentNombre !== null ? await deps.intents.findByNombre(intentNombre) : null;
            await deps.emit({
              name: "workflow/delegacion.turno",
              id: `delegacion-${tipo}:${inbound.id}`,
              data: {
                leadId: lead.id,
                mensajeId: inbound.id,
                runIds: tramos.map((t) => t.runId),
                tipo,
                intentId: intent?.id ?? null,
                respondio,
              },
            });
          });

    if (resultadoBaja === "nueva" || resultadoBaja === "repetida") {
      // La baja corta antes del LLM: no se clasifica.
      await emitirMensajeRecibido(null);
      // Un tramo delegado se entera: el flujo no le vuelve a escribir.
      await avisarTramo(await leerTramos("leer-delegaciones-baja"), "baja", null, false);
      const sent = resultadoBaja === "nueva";
      logger.info("pipeline-complete", { duplicate: false, sent, skipped: "baja" });
      return {
        leadId: lead.id,
        leadCreated,
        sessionId: session.id,
        sessionCreated,
        conversacionId: conv.id,
        agentSource: "baja",
        sent,
        duplicate: false,
      };
    }

    // ¿Contesta un flujo en lugar del agente? (decisión 2 del dueño). Va después
    // de la baja —un BAJA corta antes que cualquier flujo— y sólo dentro del
    // horario de atención: fuera de horario el envío del flujo se diferiría
    // hasta la apertura, y un flujo no puede prometer una respuesta que llega
    // horas después. Fuera de horario contesta lo de siempre (la plantilla de
    // `agente_config`, más abajo) y el flujo se entera como cualquier "Mensaje
    // recibido", sin contestar el turno (decisión del dueño). Primero sin
    // clasificar; si algún interceptor mira el intent, se vuelve a preguntar
    // después de clasificar y antes del agente. No espera a que el flujo
    // corra: la corrida la arranca `workflow-disparar` con el disparo de
    // siempre.
    //
    // El turno interceptado se clasifica igual (decisión del dueño): lo que se
    // ahorra es la respuesta del agente, no la clasificación, que es barata. Sin
    // el intent no se cuelgan las etiquetas automáticas y los demás flujos del
    // mensaje no lo ven. La baja, que cortó arriba, sigue sin clasificar.
    //
    // Si el flujo que coincidía no va a poder responder —un tope saltaría su
    // envío, o la corrida no arrancaría por su política de concurrencia—, el
    // interceptor no intercepta y contesta el agente
    // (`interceptor.service.ts`). Queda en el log con el motivo; en
    // `turnos_interceptados` sólo entran los turnos que contesta un flujo.
    // La config del turno se memoriza: Inngest vuelve a correr el handler en
    // cada paso, y si el admin guarda entre dos pasadas, el mismo turno
    // mezclaría dos configs (plantilla, tope de descuento, umbral de escalado).
    // Sólo los campos que este handler lee: `instrucciones` y el resto los lee
    // el agente adentro de `respond`, que ya es un step, y no hace falta
    // guardarlos en el estado del run.
    const config = await step.run("leer-config", async () => {
      const c = await deps.configProvider.get();
      return {
        horario: c.horario,
        horario_timezone: c.horario_timezone,
        horario_equipo: c.horario_equipo,
        plantilla_fuera_horario: c.plantilla_fuera_horario,
        ventana_contexto_mensajes: c.ventana_contexto_mensajes,
        descuento_max_pct: c.descuento_max_pct,
        escalar_umbral_intents: c.escalar_umbral_intents,
      };
    });
    // Step propio: Inngest vuelve a correr el handler en cada paso, y una
    // lectura del reloj afuera de un step cambia si una pasada cruza la hora
    // de cierre — el interceptor ya decidió con el negocio abierto y la pasada
    // siguiente manda la plantilla de fuera de horario.
    const abierto = await step.run("decidir-horario", async () =>
      estaAbierto(config.horario, config.horario_timezone, new Date()),
    );
    // Step propio por la misma razón que `decidir-horario`: Inngest vuelve a
    // correr el handler en cada paso, y una lectura viva del reloj cambiaría el
    // modo a mitad del turno. El copiloto es de WhatsApp (las acciones de la
    // tarjeta abren WhatsApp Web y el ahorro es de la API de WhatsApp): en
    // Instagram y Messenger el modo se calcula sin override y sin equipo, o sea
    // el comportamiento de siempre. `agenteAbierto` reusa la decisión de arriba
    // para que las dos nunca discrepen.
    //
    // También acá se exige el repositorio de borradores: con el modo en Copiloto y
    // sin él el turno tiene que fallar ANTES de clasificar y de llamar al agente,
    // no después de haber pagado las dos llamadas al LLM.
    const modo: ModoDecidido = await step.run("decidir-modo", async () => {
      const decidido = decidirModo({
        override: parsed.canal === "wa" ? conv.modo_respuesta_override : null,
        // Una corrida en vuelo durante el deploy puede traer una config
        // memoizada sin `horario_equipo` (el step `leer-config` es anterior a
        // ese campo): se lee como sin rangos, o sea "no hay equipo".
        equipoAbierto:
          parsed.canal === "wa" &&
          equipoAbiertoAhora(
            { ...config, horario_equipo: config.horario_equipo ?? horarioSinRangos() },
            new Date(),
          ),
        agenteAbierto: abierto,
      });
      if (decidido === "copiloto") {
        const borradores = exigirBorradores(deps);
        // Con Copiloto la invalidación sí importa: un borrador viejo vigente
        // seguiría ofreciéndose. Se repite acá, dentro del step, y si falla otra
        // vez el turno falla en voz alta (Inngest reintenta el step).
        if (invalidacionFallo) await borradores.descartarVigentes(conv.id);
      }
      return decidido;
    });
    const interceptor = deps.interceptor;
    const avisarDescarte = (decision: DecisionIntercepcion) => {
      if (decision.tipo === "no" && decision.descartada) {
        logger.info("intercepcion-descartada", {
          workflow_id: decision.descartada.workflowId,
          motivo: decision.descartada.motivo,
        });
      }
    };
    let intercepcion: DecisionIntercepcion = { tipo: "no" };
    if (interceptor && abierto) {
      intercepcion = await step.run("decidir-intercepcion", () =>
        interceptor.decidir({
          leadId: lead.id,
          leadSessionId: session.id,
          datos: datosMensaje,
          contexto: contextoDeDisparo({
            lead,
            sesion: session,
            canal: parsed.canal,
            respondio: true,
          }),
          intentConocido: false,
          respuestaInteractiva: respuestaInteractiva
            ? { respondeA: respuestaInteractiva.responde_a }
            : null,
        }),
      );
      avisarDescarte(intercepcion);
    }

    // El turno lo contesta el flujo: queda anotado (auditable desde el Inbox),
    // el flujo se entera por el disparo con `interceptadoPor` —que además deja
    // afuera a los otros interceptores— y el turno termina después de etiquetar.
    // Sin respuesta del agente no hay `turn.completed`: extraer el Twin sería
    // otra llamada al LLM.
    const registrarIntercepcion = (decision: Intercepcion) =>
      step.run("registrar-intercepcion", () => interceptor!.registrar(inbound.id, decision));
    const cortarPorFlujo = async (decision: Intercepcion): Promise<OnMessageReceivedResult> => {
      await registrarIntercepcion(decision);
      logger.info("pipeline-complete", {
        duplicate: false,
        sent: false,
        skipped: "interceptado_por_flujo",
        motivo: decision.motivo,
        workflow_id: decision.workflowId,
      });
      return {
        leadId: lead.id,
        leadCreated,
        sessionId: session.id,
        sessionCreated,
        conversacionId: conv.id,
        agentSource: "flujo",
        sent: false,
        duplicate: false,
      };
    };

    // Fuera de horario: no se invoca ningun LLM (ni classifier ni agente).
    // Con plantilla configurada se responde eso; sin ella, no se responde
    // nada y la sesion queda como esta para que el triage humano la retome.
    // Fuera de horario nunca hay turno interceptado: el interceptor ni se
    // consulta (arriba), así que la plantilla es la única respuesta.
    // La rama corre solo con el resultado Fuera de horario (§3.2). Con Copiloto
    // y el agente cerrado el turno sigue por `classify` / `respond` como en
    // horario: el borrador no sale solo, así que el agente cerrado no lo impide.
    if (modo === "fuera_de_horario") {
      // Sin LLM no hay intent, pero el flujo se entera igual (y antes de la
      // plantilla, como en el camino normal antes de la respuesta del agente).
      await emitirMensajeRecibido(null);
      let templateSent = false;
      if (config.plantilla_fuera_horario !== "") {
        await step.run("send", () =>
          deps.metaApi.sendOutbound({
            conversacionId: conv.id,
            leadSessionId: session.id,
            canal: parsed.canal,
            to: parsed.meta_user_id,
            contenido: config.plantilla_fuera_horario,
            sender: "ia",
            idempotencyKey: claveSaliente(parsed.meta_message_id),
            // Este camino corta antes del clasificador y de las reglas, así que
            // no deja fila en ninguna de las cuatro tablas de auditoría. Sin la
            // marca, el saliente es indistinguible de un turno que nadie midió
            // y la auditoría tiene que decir que no sabe — cuando sí se sabe.
            plantilla: "fuera_horario",
          }),
        );
        templateSent = true;
      }
      logger.info("pipeline-complete", {
        duplicate: false,
        sent: templateSent,
        skipped: "fuera_de_horario",
      });
      return {
        leadId: lead.id,
        leadCreated,
        sessionId: session.id,
        sessionCreated,
        conversacionId: conv.id,
        agentSource: "handoff",
        sent: templateSent,
        duplicate: false,
      };
    }

    // El entrante viaja junto al texto: no cambia la clasificación, pero es lo
    // que hace que el gasto del clasificador quede atribuido a esta sesión en
    // vez de aparecer como costo sin dueño en el reporte por lead.
    //
    // Si la clasificación falla del todo (Inngest ya agotó sus reintentos y
    // tira el `StepError` acá), el flujo se entera igual, sin intent, y
    // después el turno falla como fallaba antes: el agente no contesta sin
    // clasificar. Un turno que ya contesta un flujo lo sigue contestando: su
    // respuesta no depende del intent, y queda anotado antes de fallar.
    // Los tramos delegados se leen antes de clasificar: si el turno falla de
    // acá en adelante, el tramo sale por «Error» (ver el `catch`).
    const tramos = await leerTramos("leer-delegaciones");
    if (tramos.length > 0) {
      avisarErrorAlTramo = () => avisarTramo(tramos, "error", null, false);
    }

    let classification: Awaited<ReturnType<typeof deps.intentClassifier.classify>>;
    try {
      classification = await step.run("classify", () =>
        deps.intentClassifier.classify(parsed.contenido ?? "", {
          mensajeId: inbound.id,
          leadSessionId: session.id,
        }),
      );
    } catch (error) {
      const yaDecidida = intercepcion.tipo === "intercepta" ? intercepcion : null;
      await emitirMensajeRecibido(null, yaDecidida?.workflowId);
      if (yaDecidida) await registrarIntercepcion(yaDecidida);
      throw error;
    }
    if (intercepcion.tipo === "necesita_intent" && interceptor) {
      intercepcion = await step.run("decidir-intercepcion-con-intent", async () => {
        const intent =
          classification.intent_nombre !== null
            ? await deps.intents.findByNombre(classification.intent_nombre)
            : null;
        return interceptor.decidir({
          leadId: lead.id,
          leadSessionId: session.id,
          datos: datosMensaje,
          contexto: contextoDeDisparo({
            lead,
            sesion: session,
            canal: parsed.canal,
            respondio: true,
            intent: {
              id: intent?.id ?? null,
              mensajeAt: new Date(inbound.created_at).toISOString(),
            },
          }),
          intentConocido: true,
          respuestaInteractiva: null,
        });
      });
      avisarDescarte(intercepcion);
    }
    const interceptadoPor = intercepcion.tipo === "intercepta" ? intercepcion : null;
    await emitirMensajeRecibido(classification.intent_nombre, interceptadoPor?.workflowId);
    logger.info("classified", {
      intent: classification.intent_nombre,
      confidence: classification.confidence,
    });

    // Step propio y no adentro de `respond`: etiquetar no es parte de generar
    // una respuesta, y separarlo garantiza que ocurra igual conteste una regla
    // enlatada —que devuelve temprano— o conteste el LLM. Justo los turnos que
    // alguien se tomó el trabajo de automatizar son los que más señal tienen.
    const etiquetasNuevas = await step.run("etiquetar-por-reglas", () =>
      etiquetarPorReglas(
        lead.id,
        classification.intent_nombre,
        { current_stage: session.current_stage, urgencia: session.urgencia },
        deps,
        logger,
      ),
    );

    // Los flujos con trigger "Etiqueta asignada": una por etiqueta que quedó
    // puesta de verdad en este turno. Step aparte del etiquetado para que un
    // fallo al mandar el evento no repita las escrituras.
    if (etiquetasNuevas.length > 0) {
      await step.run("emit-workflow-etiquetas", async () => {
        // El intent de ESTE turno, como en «Mensaje recibido»: la base recién
        // lo escribe cuando contesta el agente, y una condición «Intent
        // detectado» en el flujo leería el turno anterior.
        const intent =
          classification.intent_nombre !== null
            ? await deps.intents.findByNombre(classification.intent_nombre)
            : null;
        const contexto = contextoDeDisparo({
          lead,
          sesion: session,
          canal: parsed.canal,
          intent: {
            id: intent?.id ?? null,
            mensajeAt: new Date(inbound.created_at).toISOString(),
          },
        });
        for (const tagId of etiquetasNuevas) {
          await deps.emit({
            name: "workflow/disparo.recibido",
            id: `workflow-disparo:etiqueta:${lead.id}:${tagId}:${inbound.id}`,
            data: {
              disparador: "etiqueta_asignada",
              leadId: lead.id,
              leadSessionId: session.id,
              contexto,
              datos: { tagId },
            },
          });
        }
      });
    }

    // Lo contesta el flujo: las etiquetas de arriba ya quedaron, pero ni el
    // agente ni las reglas IF/THEN contestan.
    if (interceptadoPor) return cortarPorFlujo(interceptadoPor);

    const conversationTurn = await step.run("build-turn", () =>
      buildConversationTurn(
        conv.id,
        deps.messages,
        session.context_summary,
        config.ventana_contexto_mensajes,
      ),
    );

    // En Copiloto el borrador arranca ANTES de `respond` (la tarjeta muestra
    // "Redactando…") y es idempotente por entrante. Si no hay un borrador
    // `redactando` donde escribir, el turno no llama al agente: pagar el LLM para
    // tirar la respuesta es plata sin efecto.
    //  - `obsoleto`: llegó otro entrante mientras tanto; el turno de ése redacta.
    //  - `existente` que ya no está `redactando` (listo, usado o en error): este
    //    entrante ya tuvo su borrador y `completar` no lo pisaría.
    const arranque: { borradorId: UUID | null; omitido: "obsoleto" | "ya_resuelto" | null } =
      modo === "copiloto"
        ? await step.run("iniciar-borrador", async () => {
            const r = await exigirBorradores(deps).iniciar({
              conversacionId: conv.id,
              leadSessionId: session.id,
              mensajeOrigenId: inbound.id,
            });
            if (r.resultado === "obsoleto") {
              return { borradorId: null, omitido: "obsoleto" as const };
            }
            if (r.resultado === "existente" && r.estado !== "redactando") {
              return { borradorId: null, omitido: "ya_resuelto" as const };
            }
            return { borradorId: r.borradorId, omitido: null };
          })
        : { borradorId: null, omitido: null };
    const borradorId = arranque.borradorId;

    if (arranque.omitido !== null) {
      // Termina sin agente, como el descuento excedido: nada sale, y a los
      // tramos delegados se les avisa que la IA no contestó.
      avisarErrorAlTramo = null;
      await avisarTramo(tramos, "turno", classification.intent_nombre, false);
      logger.info("borrador-omitido", { motivo: arranque.omitido });
      logger.info("pipeline-complete", {
        duplicate: false,
        sent: false,
        skipped: "borrador_omitido",
      });
      return {
        leadId: lead.id,
        leadCreated,
        sessionId: session.id,
        sessionCreated,
        conversacionId: conv.id,
        agentSource: "handoff",
        sent: false,
        duplicate: false,
      };
    }

    // El turno falla igual que siempre, pero la tarjeta no puede quedarse en
    // "Redactando…" para siempre: si un step entre `iniciar-borrador` y
    // `guardar-borrador` agota sus reintentos, el borrador queda en error con un
    // código corto (nunca el texto del proveedor) y la persona puede reintentar.
    // Sin borrador (Automático, o el entrante ya no era el último) no hay nada
    // que marcar y el error pasa tal cual.
    const conErrorDeBorrador = async <T>(hacer: () => Promise<T>): Promise<T> => {
      try {
        return await hacer();
      } catch (error) {
        if (borradorId !== null) {
          await step.run("marcar-borrador-error", () =>
            exigirBorradores(deps).marcarError(borradorId, codigoDeErrorBorrador(error)),
          );
        }
        throw error;
      }
    };

    // Lectura pura y determinística: el step devuelve el JSON ya armado (no
    // las filas con `Date`), que es lo que Inngest memoiza entre reintentos.
    const vehiculos = await conErrorDeBorrador(() =>
      step.run("leer-vehiculos", async () =>
        deps.vehiculos ? vehiculosParaAgente(await deps.vehiculos.listByLeadId(lead.id)) : [],
      ),
    );

    const agentResult: AgentTurnResult = await conErrorDeBorrador(() =>
      step.run("respond", () =>
        deps.aiAgent.respond(
          buildRespondInput({
            leadSessionId: session.id,
            conversationTurn,
            classification,
            mensajeOrigenId: inbound.id,
            tramos,
            vehiculos,
          }),
        ),
      ),
    );
    logger.info("agent-decision", {
      source: agentResult.source,
      respuesta_tipo: agentResult.respuesta_tipo,
      tool_calls_count: agentResult.tool_calls?.length ?? 0,
    });

    // Turno resuelto por el LLM: ninguna regla lo cubrió. Sin esta fila la
    // clasificación se pierde y `rule_executions` termina registrando, por
    // construcción, solo los intents que YA tienen regla — justo los que no
    // hace falta descubrir. Se audita contra el mensaje ENTRANTE, igual que la
    // auditoría de reglas, y antes de la guarda de descuento: el modelo ya
    // corrió y ya se pagó, aunque después la respuesta se descarte.
    if (agentResult.source === "llm") {
      await conErrorDeBorrador(() =>
        step.run("auditar-clasificacion", async () => {
          // El clasificador ya validó el nombre contra los intents activos, así
          // que un nombre no nulo resuelve; nulo = no reconoció ninguno.
          const intent =
            classification.intent_nombre !== null
              ? await deps.intents.findByNombre(classification.intent_nombre)
              : null;
          await deps.turnClassifications.create({
            mensaje_id: inbound.id,
            intent_id: intent?.id ?? null,
            intent_nombre: classification.intent_nombre,
            confidence: classification.confidence,
          });
        }),
      );
    }

    let sent = false;
    if (agentResult.source !== "handoff") {
      const descuentoOfrecido = excedeDescuento(
        agentResult.respuesta_contenido,
        config.descuento_max_pct,
      );
      if (descuentoOfrecido !== null) {
        // Se descarta la respuesta: no llega al cliente. La sesion pasa a
        // triage humano con la IA pausada hasta que alguien la revise.
        logger.warn("agente.descuento_excedido", {
          ofrecido: descuentoOfrecido,
          maximo: config.descuento_max_pct,
          sessionId: session.id,
        });
        await conErrorDeBorrador(() =>
          step.run("pausar-por-descuento", () =>
            deps.handoff
              ? deps.handoff.pause({
                  sessionId: session.id,
                  reasonCode: "discount_limit",
                  source: "pipeline_guard",
                  sourceEventKey: `discount-limit:${session.id}:${parsed.meta_message_id}`,
                  notifyCustomer: true,
                })
              : deps.sessions.update(session.id, {
                  current_stage: "requiere_humano",
                  ia_pausada: true,
                }),
          ),
        );
        if (borradorId !== null) {
          await conErrorDeBorrador(() =>
            step.run("descartar-borrador-descuento", () =>
              exigirBorradores(deps).descartar(borradorId),
            ),
          );
        }
        // El tramo ve la sesión en manos de una persona (`discount_limit`).
        avisarErrorAlTramo = null;
        await avisarTramo(tramos, "turno", classification.intent_nombre, false);
        logger.info("pipeline-complete", {
          duplicate: false,
          sent: false,
          skipped: "descuento_excedido",
        });
        return {
          leadId: lead.id,
          leadCreated,
          sessionId: session.id,
          sessionCreated,
          conversacionId: conv.id,
          agentSource: "handoff",
          sent: false,
          duplicate: false,
        };
      }

      if (modo === "copiloto") {
        // Nada sale por la API: la respuesta (de regla o de LLM) queda como
        // borrador para que una persona la envíe desde WhatsApp Web. El texto
        // no se loguea. `sent` queda en false, y de ahí `respondio` del tramo
        // delegado: la IA no le contestó al cliente.
        let guardado = false;
        if (borradorId !== null) {
          guardado = await conErrorDeBorrador(() =>
            step.run("guardar-borrador", async () => {
              const completado = await exigirBorradores(deps).completar(borradorId, {
                contenido: agentResult.respuesta_contenido,
                origen: agentResult.source === "rule" ? "regla" : "ia",
                reglaId: agentResult.regla_id ?? null,
              });
              // `null`: ya no estaba redactando (otro lo reemplazó o se descartó).
              return completado !== null;
            }),
          );
        }
        logger.info(guardado ? "borrador-listo" : "borrador-no-guardado", {
          origen: agentResult.source,
        });
      } else {
        await step.run("send", () =>
          deps.metaApi.sendOutbound({
            conversacionId: conv.id,
            leadSessionId: session.id,
            canal: parsed.canal,
            to: parsed.meta_user_id,
            contenido: agentResult.respuesta_contenido,
            sender: "ia",
            idempotencyKey: claveSaliente(parsed.meta_message_id),
          }),
        );
        sent = true;
        logger.info("send-out");
      }

      // La tabla `rule_executions` existe desde Slice 1 y nunca se escribio:
      // el agente devolvia `regla_id` y nadie lo guardaba, asi que no habia
      // forma de responder "por que el cliente recibio esta respuesta".
      // Se audita contra el mensaje ENTRANTE, que es el que disparo la regla.
      if (agentResult.source === "rule" && agentResult.regla_id && agentResult.intent_id) {
        await step.run("auditar-regla", () =>
          deps.ruleExecutions.create({
            regla_id: agentResult.regla_id as UUID,
            mensaje_id: inbound.id,
            matched_intent_id: agentResult.intent_id as UUID,
          }),
        );
      }
    } else {
      // Si hoy la IA no respondería, tampoco hay borrador (§3.1): el que arrancó
      // como "Redactando…" se descarta.
      if (borradorId !== null) {
        await conErrorDeBorrador(() =>
          step.run("descartar-borrador", () => exigirBorradores(deps).descartar(borradorId)),
        );
      }
      logger.info("send-skipped", { reason: "handoff" });
    }

    // El turno ya salió. A los tramos delegados no se les avisa desde acá: lo
    // hace el extractor cuando termina, con el Twin de este turno escrito
    // (`update-lead-twin`). Viaja el intent del turno y si el agente contestó.
    avisarErrorAlTramo = null;
    const delegacion: DelegacionDelTurno | null =
      tramos.length === 0
        ? null
        : await step.run("delegacion-del-turno", async () => {
            const intent =
              classification.intent_nombre !== null
                ? await deps.intents.findByNombre(classification.intent_nombre)
                : null;
            return {
              runIds: tramos.map((t) => t.runId),
              intentId: intent?.id ?? null,
              respondio: sent,
            };
          });

    await step.run("emit-turn", () =>
      deps.emit({
        name: "lead-session/turn.completed",
        data: {
          leadSessionId: session.id,
          conversationTurn,
          // El entrante que disparó el turno. Sin esto la procedencia que
          // escribe el extractor queda con `mensaje_origen_id: null` y el Twin
          // no puede decir de qué mensaje ni de qué hora salió cada dato.
          mensajeOrigenId: inbound.id,
          ...(delegacion ? { delegacion } : {}),
        },
      }),
    );

    // §4.2: N turnos seguidos sin intent escalan. El evento lleva la racha y
    // no solo este turno: con `[classification]` el evaluador nunca juntaba
    // más de uno y, con el umbral de fábrica (2), no escalaba jamás. La racha
    // se lee acá y no en `auto-handoff` porque este pipeline está serializado
    // por lead: nadie escribe un turno nuevo entre la lectura y el evento. El
    // turno actual va en memoria —su auditoría puede no estar escrita todavía—
    // y el umbral viaja con el evento para que las dos puntas usen la misma
    // config aunque el admin la cambie en el medio.
    await step.run("emit-handoff-eval", async () => {
      const umbral = config.escalar_umbral_intents;
      const previos =
        classification.intent_nombre === null
          ? await turnosPreviosSinIntent(session.id, inbound.id, umbral - 1, deps)
          : [];
      await deps.emit({
        name: "lead-session/auto-handoff.evaluate",
        data: {
          leadSessionId: session.id,
          recentClassifications: [...previos, classification],
          threshold: umbral,
        },
      });
    });

    logger.info("pipeline-complete", { duplicate: false, sent });

    return {
      leadId: lead.id,
      leadCreated,
      sessionId: session.id,
      sessionCreated,
      conversacionId: conv.id,
      agentSource: agentResult.source,
      sent,
      duplicate: false,
    };
  } catch (e) {
    logger.error("pipeline-error", {
      error_name: (e as Error).name,
      error_message: (e as Error).message,
    });
    // El turno falló con un tramo delegado vivo: sale por «Error». Si el aviso
    // también falla, se propaga el error original, que es el que importa.
    if (avisarErrorAlTramo) {
      try {
        await avisarErrorAlTramo();
      } catch (aviso) {
        logger.error("delegacion-aviso-error-fallido", { error_name: (aviso as Error).name });
      }
    }
    throw e;
  }
}

/**
 * Los entrantes anteriores de la sesión que el agente contestó sin reconocer
 * intent, seguidos y pegados al turno actual, del más viejo al más nuevo y
 * hasta `max`. Es la racha del §4.2.
 *
 * Solo alarga la racha un turno con fila en `turn_classifications` e intent
 * nulo. Todo lo demás la corta: un intent reconocido —lo haya contestado el
 * LLM o una regla, que audita en `rule_executions`— y también un turno que el
 * agente no contestó (lo interceptó un flujo, la IA estaba pausada, fuera de
 * horario, una baja). El escalado mide si el agente entiende al cliente: las
 * respuestas libres que pide un flujo ("¿tu patente?") no tienen intent por
 * diseño, y contarlas escalaría al primer turno del agente después del flujo.
 * Cortar en los turnos pausados es además lo que evita que, al reanudar la IA,
 * un solo turno sin intent la vuelva a pausar.
 */
async function turnosPreviosSinIntent(
  sessionId: UUID,
  mensajeActualId: UUID,
  max: number,
  deps: Pick<OnMessageReceivedDeps, "messages" | "turnClassifications">,
): Promise<IntentClassification[]> {
  if (max <= 0) return [];
  const entrantes = await deps.messages.listBySessionId(sessionId, {
    direction: "in",
    limit: max + 1,
  });
  const previos = entrantes
    .filter((m) => m.id !== mensajeActualId)
    .reverse()
    .slice(0, max);
  const racha: IntentClassification[] = [];
  for (const m of previos) {
    const turno = await deps.turnClassifications.findByMensajeId(m.id);
    if (turno === null || turno.intent_nombre !== null) break;
    racha.push({ intent_nombre: null, confidence: turno.confidence });
  }
  return racha.reverse();
}

/**
 * El repositorio de borradores, o un `IllegalStateError`: con el modo decidido en
 * Copiloto, seguir sin él sería mandar por la API lo que el equipo pidió
 * redactar.
 *
 * Se llama dentro de `step.run` (en `decidir-modo`), y ahí Inngest reintenta
 * cualquier error del step según su política, también un `IllegalStateError`:
 * el `isNonRetriable` de `makeOnMessageReceivedFn` mira el error que sale de
 * toda la función, no el que se lanza dentro de un step. Es inocuo porque falla
 * antes de clasificar y de llamar al agente: los reintentos no gastan nada, y al
 * agotarse el turno falla en voz alta.
 */
function exigirBorradores(
  deps: Pick<OnMessageReceivedDeps, "borradores">,
): NonNullable<OnMessageReceivedDeps["borradores"]> {
  if (!deps.borradores) {
    throw new IllegalStateError(
      "Modo Copiloto sin OnMessageReceivedDeps.borradores: el borrador no tiene dónde guardarse",
      "copiloto_sin_repositorio",
    );
  }
  return deps.borradores;
}

async function resolveLead(
  parsed: ParsedMessage,
  leads: LeadsRepository,
): Promise<{ lead: Lead; created: boolean }> {
  const existing =
    parsed.canal === "wa"
      ? await leads.findByTelefono(parsed.meta_user_id)
      : await leads.findByMetaUserId(parsed.canal, parsed.meta_user_id);

  if (existing)
    return { lead: await sincronizarNombrePerfil(existing, parsed, leads), created: false };

  const created = await leads.create(buildPlaceholderLead(parsed));
  return { lead: created, created: true };
}

/**
 * Cuelga las etiquetas que las reglas mandan para este turno.
 *
 * `assignToLead` con `source: "workflow"` es idempotente y además no revive una
 * etiqueta que una persona sacó a mano: la fila descartada sigue en la tabla
 * justamente para eso. Así el reintento de Inngest es inofensivo y el vendedor
 * no ve volver lo que acaba de quitar.
 *
 * Un fallo no tumba el turno: el mensaje del cliente tiene que contestarse
 * igual y la etiqueta es una anotación. Se traga adentro del step para que
 * Inngest no reintente el turno entero —y con él la llamada al LLM— por una
 * fila de `lead_tags`; el próximo mensaje del cliente vuelve a intentarlo.
 *
 * Devuelve las que quedaron puestas **en este turno**: las que el lead ya
 * tenía no cuentan —re-colgarlas no es ponerle una etiqueta, y dispararía el
 * flujo "Etiqueta asignada" en cada mensaje— y las que una persona sacó
 * tampoco, porque la regla no las revive.
 */
async function etiquetarPorReglas(
  leadId: UUID,
  intentNombre: string | null,
  contexto: Record<string, unknown>,
  deps: OnMessageReceivedDeps,
  logger: Logger,
): Promise<UUID[]> {
  const nuevas: UUID[] = [];
  try {
    const tagIds = await deps.ruleEngine.etiquetasPara({
      intent_nombre: intentNombre,
      context: contexto,
    });
    if (tagIds.length === 0) return nuevas;

    const yaPuestas = new Set((await deps.tags.listByLead(leadId)).map((t) => t.id));
    for (const tagId of tagIds) {
      const fila = await deps.tags.assignToLead(leadId, tagId, "workflow");
      if (!yaPuestas.has(tagId) && fila.quitada_at === null) nuevas.push(tagId);
      yaPuestas.add(tagId);
    }
    logger.info("etiquetas-por-regla", { cantidad: tagIds.length });
  } catch (e) {
    logger.warn("etiquetado-por-regla-fallo", {
      lead_id: leadId,
      error_name: (e as Error).name,
    });
  }
  return nuevas;
}

/**
 * Qué pasó con una palabra de baja, y con eso qué hace el resto del turno:
 *
 * - `nueva`: se registró. Sale sólo la confirmación; el agente no contesta.
 * - `repetida`: el número ya estaba dado de baja. No sale nada: volver a
 *   escribir BAJA es la misma intención, y ni la confirmación repetida ni una
 *   respuesta de ventas le sirven a quien la escribe.
 * - `no_registrable`: no hay teléfono que anotar (Instagram, Messenger o un
 *   número que la lista rechaza). No quedó ninguna baja, así que el turno
 *   sigue como cualquier otro: callar sin haber registrado nada sería peor.
 */
type ResultadoBaja = "nueva" | "repetida" | "no_registrable";

/**
 * Anota la baja en `difusion_supresiones` como propia (`palabra_clave`), con la
 * palabra en `detalle` y nunca el texto del cliente.
 *
 * Sólo WhatsApp: la lista de bajas es de teléfonos, e Instagram y Messenger no
 * exponen uno (`leads.telefono` guarda `ig:<id>` de relleno). Se usa el número
 * que escribió (`meta_user_id`), no el del lead: si el lead se fusionó, la baja
 * es de quien la pidió.
 *
 * Devuelve si la baja es **nueva** o **repetida** —un número que ya estaba
 * dado de baja no se vuelve a confirmar—, o `no_registrable` si no hay
 * teléfono que anotar. `registrar` es idempotente y no dice si creó, así que
 * se mira antes; el pipeline serializa por `meta_user_id` (`concurrency`), así
 * que dos mensajes del mismo número no compiten entre la lectura y la escritura.
 *
 * Un número que la lista no acepta (`ValidationError`) no tumba el turno: no hay
 * forma de registrarlo y reintentar repetiría lo mismo. Cualquier otro error sí
 * se propaga, a diferencia de `etiquetarPorReglas`: una baja perdida es peor que
 * un turno que Inngest reintenta —si falla del todo, el cliente que pidió la baja
 * se queda sin respuesta del agente, y eso es aceptable; recibir marketing
 * después, no—.
 */
async function registrarBaja(
  parsed: ParsedMessage,
  leadId: UUID,
  palabra: PalabraDeBaja,
  supresiones: OnMessageReceivedDeps["supresiones"],
  logger: Logger,
): Promise<ResultadoBaja> {
  if (parsed.canal !== "wa") {
    logger.info("baja-sin-telefono", { lead_id: leadId, palabra });
    return "no_registrable";
  }
  try {
    const previas = await supresiones.activasPorTelefonos([parsed.meta_user_id]);
    if (previas.length > 0) {
      logger.info("baja-repetida", { lead_id: leadId, palabra });
      return "repetida";
    }
    await supresiones.registrar({
      telefono: parsed.meta_user_id,
      origen: "palabra_clave",
      detalle: palabra,
      lead_id: leadId,
    });
    logger.info("baja-registrada", { lead_id: leadId, palabra });
    return "nueva";
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    logger.warn("baja-telefono-invalido", { lead_id: leadId, error_name: e.name });
    return "no_registrable";
  }
}

/**
 * Deja el teléfono del lead recién creado en `lead_identificadores`.
 *
 * `leads.telefono` sigue siendo la identidad canónica de WhatsApp que usa el
 * pipeline, pero el detector de duplicados no mira esa columna: mira la tabla.
 * Sin esta escritura los leads que nacen del webhook son invisibles para la
 * detección y solo los del backfill tienen identificador.
 *
 * Un fallo no tumba el turno: el lead ya existe y el mensaje del cliente tiene
 * que contestarse igual. Se traga adentro del step y no afuera para que Inngest
 * no reintente por una fila que solo sirve para detectar duplicados; el cron
 * global de merge vuelve a pasar por este lead de todos modos.
 */
async function registrarTelefono(
  lead: Lead,
  identificadores: LeadIdentificadoresRepository,
  logger: Logger,
): Promise<void> {
  try {
    await identificadores.create({
      lead_id: lead.id,
      tipo: "telefono",
      valor: normalizarIdentificador("telefono", lead.telefono),
      valor_original: lead.telefono,
      principal: true,
      origen: "meta",
    });
  } catch (e) {
    // Sin `error_message` a propósito: `mapPostgrestError` le concatena el
    // `details` de Postgres, y el de un 23505 sobre esta tabla trae el valor
    // que colisionó — es decir, el teléfono. `error_name` distingue igual las
    // cuatro causas reales (conflicto, validación, permisos, infra).
    logger.warn("identificador-no-creado", {
      lead_id: lead.id,
      tipo: "telefono",
      error_name: (e as Error).name,
    });
  }
}

/**
 * Mantiene `nombre_perfil` al día con lo que dice Meta.
 *
 * El dato es de la plataforma, no nuestro: si el cliente se cambia el nombre en
 * WhatsApp, el nuestro tiene que seguirlo. Sin cambio no hay UPDATE: escribir en
 * cada mensaje entrante movería `updated_at` de todos los leads y desordenaría
 * la lista, que ordena por esa columna.
 *
 * `leads.nombre` se toca en un solo caso: cuando está vacío. Es la misma siembra
 * que hace `buildPlaceholderLead`, acá para los leads que ya existían sin nombre
 * —quedan arreglados en cuanto el cliente vuelve a escribir, sin esperar a que
 * alguien los renombre a mano—. Un `nombre` ya cargado no se pisa jamás: lo
 * escribió el vendedor y un alias de redes no compite con eso.
 */
async function sincronizarNombrePerfil(
  lead: Lead,
  parsed: ParsedMessage,
  leads: LeadsRepository,
): Promise<Lead> {
  const nuevo = parsed.nombre_perfil;
  const patch: Parameters<LeadsRepository["update"]>[1] = {};

  // `null` es "este canal no lo manda", no "se lo borraron": no pisa lo guardado.
  if (nuevo !== null && nuevo !== lead.nombre_perfil) patch.nombre_perfil = nuevo;

  // Para sembrar sirve el que llega y, si no llega, el que ya estaba guardado:
  // un lead anónimo con perfil viejo se arregla igual aunque este mensaje venga
  // sin nombre.
  const paraSembrar = (nuevo ?? lead.nombre_perfil)?.trim();
  if (lead.nombre.trim() === "" && paraSembrar) patch.nombre = paraSembrar;

  if (Object.keys(patch).length === 0) return lead;
  return leads.update(lead.id, patch);
}

function buildPlaceholderLead(parsed: ParsedMessage): Parameters<LeadsRepository["create"]>[0] {
  const telefono =
    parsed.canal === "wa" ? parsed.meta_user_id : `${parsed.canal}:${parsed.meta_user_id}`;
  const meta_user_ids: MetaUserIds = {};
  meta_user_ids[canalKey(parsed.canal)] = parsed.meta_user_id;
  return {
    // `nombre` es el nombre que le pone la casa y `nombre_perfil` el que reporta
    // Meta: son dos cosas distintas y por eso viven en columnas separadas. Pero
    // nacer vacío dejaba al lead como "Sin nombre" en la bandeja teniendo el de
    // WhatsApp guardado al lado, así que el perfil SIEMBRA el hueco.
    //
    // Sembrar no es competir: a partir de acá `nombre` es nuestro y Meta no lo
    // vuelve a tocar nunca —ni cuando el cliente se renombra en WhatsApp—. IG y
    // Messenger pueden no mandar nada y ahí sí queda vacío.
    nombre: parsed.nombre_perfil ?? "",
    nombre_perfil: parsed.nombre_perfil,
    telefono,
    email: null,
    direccion: null,
    vehiculo_marca: null,
    vehiculo_modelo: null,
    vehiculo_anio: null,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: parsed.canal,
    meta_user_ids,
  };
}

function canalKey(canal: Canal): keyof MetaUserIds {
  return canal;
}

async function resolveActiveSession(
  leadId: UUID,
  sessions: LeadSessionRepository,
): Promise<{ session: LeadSession; created: boolean }> {
  const existing = await sessions.findActiveByLeadId(leadId);
  if (existing) return { session: existing, created: false };
  const created = await sessions.create({
    lead_id: leadId,
    current_stage: "nuevo",
    urgencia: "media",
    consulta: "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
  });
  return { session: created, created: true };
}

// Adapter: Inngest step.run devuelve Jsonify<T> (serializa Dates → string en replay).
// Para nuestro flujo objetos retornados se usan solo por ID (.id), no Date fields,
// así que cast es seguro. Si en futuro alguna stage retorna Date que se usa downstream,
// agregar conversión explícita o leer fresh desde repo dentro del step.
function adaptInngestStep(step: {
  run: <U>(name: string, fn: () => Promise<U>) => Promise<unknown>;
}): StepRunner {
  return {
    run: <T>(name: string, fn: () => Promise<T>): Promise<T> => step.run(name, fn) as Promise<T>,
  };
}

/**
 * Devuelve la `Date` que el JSON de Inngest convirtió en string.
 *
 * `ParsedMessage.platform_created_at` está tipado `Date`, pero el evento viaja
 * serializado: del otro lado llega un ISO. TypeScript sigue creyendo que es una
 * `Date`, así que `.toISOString()` compila y explota en runtime —fue
 * exactamente lo que impidió persistir el primer WhatsApp real, con el mensaje
 * `input.platform_created_at?.toISOString is not a function`—.
 *
 * Se revive acá, en la frontera, y no en el repo: así el handler y todo lo que
 * está río abajo reciben lo que su tipo promete. Mismo criterio que
 * `recordatorio-seguimiento`, que hace `new Date(recordarAt)` al despertar.
 *
 * Una fecha inválida se descarta en vez de propagarse: `platform_created_at` es
 * el reloj de Meta y es opcional, y un `Invalid Date` en esa columna vale menos
 * que no tener el dato.
 */
function revivirParsed(parsed: ParsedMessage): ParsedMessage {
  const crudo = parsed.platform_created_at;
  if (crudo === null || crudo === undefined) return parsed;
  if (crudo instanceof Date) return parsed;

  const fecha = new Date(crudo as unknown as string);
  return {
    ...parsed,
    platform_created_at: Number.isNaN(fecha.getTime()) ? null : fecha,
  };
}

export function makeOnMessageReceivedFn(deps: OnMessageReceivedDeps) {
  return inngest.createFunction(
    {
      id: "on-message-received",
      // B4: serializar pipeline por meta_user_id evita races resolve-lead /
      // resolve-session cuando lead envía 2+ mensajes en paralelo. Sin esto
      // las UNIQUE constraints DB rescatan pero retries consumen LLM budget.
      // Pilot tier: latencia adicional negligible (lead humano no manda 2
      // mensajes en <100ms). Re-evaluar cap si peak > 100 msg/sec sostenido.
      concurrency: {
        key: "event.data.parsed.meta_user_id",
        limit: 1,
      },
      triggers: [{ event: messageReceived }],
    },
    async ({ event, step }) => {
      try {
        return await onMessageReceivedHandler(
          { parsed: revivirParsed(event.data.parsed) },
          deps,
          adaptInngestStep(step),
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
