import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { workflowInactividadRevisar } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import { contextoDeDisparo } from "@/lib/workflows/contexto";
import type { DisparoWorkflow } from "@/lib/workflows/disparos";
import { configDeDisparador, disparadorDe } from "@/lib/workflows/recorrer";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { Conversacion, UUID } from "@/types/entities";
import { claveDeTick, comoEventos, enLotes } from "./disparos-en-lote";

/**
 * El emisor del trigger "Inactividad": "pasa X tiempo sin respuesta".
 *
 * Cada 10 minutos revisa las sesiones activas. Una sesión está inactiva para un
 * flujo cuando **el lead no escribe hace X** (desde su último mensaje) **y la
 * última palabra fue nuestra** (el último mensaje de la conversación es
 * saliente). Si el último mensaje es del lead, el que debe la respuesta es el
 * vendedor o el agente, no el lead: un flujo de "¿seguís ahí?" sería al revés.
 *
 * ## Una vez por silencio, y sin bucles
 *
 * El silencio se identifica por el último mensaje del lead
 * (`inactividad:<flujo>:<sesión>:<último entrante>`). Lo que mande el propio
 * flujo —el recordatorio— no cambia esa clave: no abre un silencio nuevo y no
 * vuelve a disparar. Un silencio nuevo empieza sólo cuando el lead escribe.
 *
 * Sólo se dispara mientras el silencio está en `[X, X + VENTANA_MS)`. Inngest
 * deduplica el `id` 24 h; la ventana (2 h) es más corta, así que el mismo
 * silencio no vuelve a entrar cuando vence la deduplicación. Y publicar un flujo
 * nuevo no le escribe a todas las conversaciones calladas desde hace semanas.
 * Costo: si el escaneo está caído más de 2 h, esos silencios se pierden.
 */

export const CRON_INACTIVIDAD = "*/10 * * * *";
export const VENTANA_MS = 2 * 60 * 60_000;

const MS_POR_UNIDAD = { minutos: 60_000, horas: 60 * 60_000, dias: 24 * 60 * 60_000 } as const;

export interface WorkflowInactividadDeps {
  workflows: Pick<WorkflowsRepository, "listarPublicadasPorDisparador">;
  sessions: Pick<LeadSessionRepository, "listActive">;
  conversations: Pick<ConversationsRepository, "listByLeadIds">;
  messages: Pick<MessagesRepository, "listByConversacion" | "findUltimoEntranteAt">;
  leads: Pick<LeadsRepository, "listByIds">;
  logger?: Logger;
}

export interface ResultadoInactividad {
  disparos: DisparoWorkflow[];
  errores: Array<{ workflowId: UUID; error: string }>;
}

interface Umbral {
  workflowId: UUID;
  ms: number;
}

/** La conversación del lead con actividad más reciente. */
function masReciente(conversaciones: Conversacion[]): Map<UUID, Conversacion> {
  const porLead = new Map<UUID, Conversacion>();
  for (const c of conversaciones) {
    const previa = porLead.get(c.lead_id);
    if (!previa || c.ultima_actividad_at > previa.ultima_actividad_at) porLead.set(c.lead_id, c);
  }
  return porLead;
}

export async function disparosPorInactividad(
  ahora: Date,
  deps: Omit<WorkflowInactividadDeps, "logger">,
): Promise<ResultadoInactividad> {
  const resultado: ResultadoInactividad = { disparos: [], errores: [] };

  const umbrales: Umbral[] = [];
  for (const version of await deps.workflows.listarPublicadasPorDisparador("inactividad")) {
    const nodo = disparadorDe(version.grafo);
    if (nodo?.tipo !== "trigger_inactividad") continue;
    const config = configDeDisparador("trigger_inactividad", nodo.config);
    if (!config) {
      resultado.errores.push({
        workflowId: version.workflow_id,
        error: "el tiempo de inactividad no es válido",
      });
      continue;
    }
    umbrales.push({
      workflowId: version.workflow_id,
      ms: config.duracion * MS_POR_UNIDAD[config.unidad],
    });
  }
  // Sin flujos no se lee nada: el escaneo corre cada 10 minutos para siempre.
  if (umbrales.length === 0) return resultado;

  const sesiones = await deps.sessions.listActive();
  if (sesiones.length === 0) return resultado;
  const leadIds = sesiones.map((s) => s.lead_id);
  const conversacion = masReciente(await deps.conversations.listByLeadIds(leadIds));
  const leads = new Map((await deps.leads.listByIds(leadIds)).map((l) => [l.id, l]));

  for (const sesion of sesiones) {
    const lead = leads.get(sesion.lead_id);
    const conv = conversacion.get(sesion.lead_id);
    if (!lead || !conv) continue;

    const [ultimo] = await deps.messages.listByConversacion(conv.id, { limit: 1 });
    if (ultimo?.direction !== "out") continue;
    const ultimoEntrante = await deps.messages.findUltimoEntranteAt(conv.id);
    if (!ultimoEntrante) continue;
    const silencio = ahora.getTime() - ultimoEntrante.getTime();

    for (const u of umbrales) {
      if (silencio < u.ms || silencio >= u.ms + VENTANA_MS) continue;
      resultado.disparos.push({
        id: `workflow-disparo:inactividad:${u.workflowId}:${sesion.id}:${ultimoEntrante.toISOString()}`,
        data: {
          disparador: "inactividad",
          workflowId: u.workflowId,
          leadId: lead.id,
          leadSessionId: sesion.id,
          // `respondio: false` es la definición del disparo: una condición
          // "¿respondió?" después de este trigger lee la verdad.
          contexto: contextoDeDisparo({ lead, sesion, canal: conv.canal, respondio: false }),
        },
      });
    }
  }
  return resultado;
}

function envolverNoRetriable<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((error: unknown) => {
    if (isNonRetriable(error)) {
      throw new NonRetriableError((error as Error).message, { cause: error });
    }
    throw error;
  });
}

export function makeWorkflowInactividadFn(deps: WorkflowInactividadDeps) {
  return inngest.createFunction(
    {
      id: "workflow-inactividad",
      concurrency: { limit: 1 },
      triggers: [{ cron: CRON_INACTIVIDAD }, { event: workflowInactividadRevisar }],
    },
    async ({ event, step }) => {
      const logger = (deps.logger ?? new NoopLogger()).child({ workflow: "workflow-inactividad" });
      const ahora = new Date(event.ts ?? Date.now());
      const base = `workflow-inactividad-${claveDeTick(ahora)}`;

      const { disparos, errores } = await step.run(`${base}-escaneo`, () =>
        envolverNoRetriable(() => disparosPorInactividad(ahora, deps)),
      );
      for (const e of errores) {
        logger.warn("inactividad-config-invalida", { workflow_id: e.workflowId, error: e.error });
      }
      for (const [i, lote] of enLotes(disparos).entries()) {
        await step.sendEvent(`${base}-envio-${i}`, comoEventos(lote));
      }
      return { disparados: disparos.length, errores: errores.length };
    },
  );
}
