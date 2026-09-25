import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { workflowProgramadosRevisar } from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import { contextoDeDisparo } from "@/lib/workflows/contexto";
import type { DisparoWorkflow } from "@/lib/workflows/disparos";
import { franjasProgramadas } from "@/lib/workflows/programacion";
import { configDeDisparador, disparadorDe } from "@/lib/workflows/recorrer";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { LeadSession, UUID } from "@/types/entities";
import { claveDeTick, comoEventos, enLotes } from "./disparos-en-lote";

/**
 * El emisor del trigger "Programado".
 *
 * Cada 5 minutos revisa qué flujos programados tienen una franja de su horario
 * en los últimos 15 (`VENTANA_MS`) y dispara el flujo **una vez por lead** de
 * la audiencia. Una ventana tres veces más larga que el intervalo aguanta un
 * tick demorado o perdido; la superposición entre ticks la absorbe el `id` del
 * disparo (`programado:<flujo>:<franja>:<lead>`), que Inngest deduplica 24 h.
 *
 * ## La audiencia
 *
 * El trigger no tiene audiencia propia (el panel ofrece frecuencia, hora, días
 * y timezone, nada más), así que la elige el flujo con sus condiciones —la
 * plantilla "Reactivar perdidos" filtra por `lead.etapa`—. El cron le entrega
 * todo lead que tenga una sesión en la base: la activa si tiene una, o la
 * última cerrada. Las cerradas se purgan a los 29 días, así que un lead que
 * perdió hace más que eso ya no está.
 *
 * La corrida sólo lleva sesión si es la activa: moverle la etapa o escalar una
 * sesión cerrada reescribiría historia. El contexto sí dice cómo terminó la
 * última.
 */

/** Cada cuánto corre el cron. */
export const CRON_PROGRAMADOS = "*/5 * * * *";
/** Cuánto mira hacia atrás cada tick. */
export const VENTANA_MS = 15 * 60_000;

export interface WorkflowProgramadosDeps {
  workflows: Pick<WorkflowsRepository, "listarPublicadasPorDisparador">;
  sessions: Pick<LeadSessionRepository, "listActive" | "listClosedBefore">;
  leads: Pick<LeadsRepository, "listByIds">;
  logger?: Logger;
}

export interface Vencido {
  workflowId: UUID;
  /** Hora local del flujo (`2026-09-14T09:00`): la clave del disparo. */
  franja: string;
}

export interface ResultadoVencidos {
  vencidos: Vencido[];
  /** Flujos publicados cuyo horario no se puede cumplir: no corren nunca. */
  errores: Array<{ workflowId: UUID; error: string }>;
}

/** Qué flujos programados tienen una franja en `(ahora - VENTANA_MS, ahora]`. */
export async function programadosVencidos(
  ahora: Date,
  deps: Pick<WorkflowProgramadosDeps, "workflows">,
): Promise<ResultadoVencidos> {
  const desde = new Date(ahora.getTime() - VENTANA_MS);
  const resultado: ResultadoVencidos = { vencidos: [], errores: [] };

  for (const version of await deps.workflows.listarPublicadasPorDisparador("programado")) {
    const nodo = disparadorDe(version.grafo);
    if (nodo?.tipo !== "trigger_cron") continue;
    const config = configDeDisparador("trigger_cron", nodo.config);
    if (!config) {
      resultado.errores.push({ workflowId: version.workflow_id, error: "config inválida" });
      continue;
    }
    // Una franja anterior a la versión no le corresponde: publicar a las 9:03
    // un flujo de las 9:00 no lo dispara hasta el día siguiente.
    const inicio = new Date(Math.max(desde.getTime(), version.created_at.getTime()));
    const r = franjasProgramadas(config, inicio, ahora);
    if ("error" in r) {
      resultado.errores.push({ workflowId: version.workflow_id, error: r.error });
      continue;
    }
    for (const franja of r.franjas) {
      resultado.vencidos.push({ workflowId: version.workflow_id, franja });
    }
  }
  return resultado;
}

/** Por lead, la sesión que lo representa: la activa, o la cerrada más reciente. */
function sesionPorLead(activas: LeadSession[], cerradas: LeadSession[]): Map<UUID, LeadSession> {
  const porLead = new Map<UUID, LeadSession>();
  for (const s of cerradas) {
    const previa = porLead.get(s.lead_id);
    if (!previa || (s.closed_at ?? 0) > (previa.closed_at ?? 0)) porLead.set(s.lead_id, s);
  }
  for (const s of activas) porLead.set(s.lead_id, s);
  return porLead;
}

/** Los disparos de una franja vencida: uno por lead de la audiencia. */
export async function disparosProgramados(
  vencido: Vencido,
  ahora: Date,
  deps: Omit<WorkflowProgramadosDeps, "workflows" | "logger">,
): Promise<DisparoWorkflow[]> {
  const porLead = sesionPorLead(
    await deps.sessions.listActive(),
    await deps.sessions.listClosedBefore(ahora),
  );
  const leads = await deps.leads.listByIds([...porLead.keys()]);

  return leads
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .flatMap((lead) => {
      const sesion = porLead.get(lead.id);
      if (!sesion) return [];
      const activa = sesion.resultado === null;
      return [
        {
          id: `workflow-disparo:programado:${vencido.workflowId}:${vencido.franja}:${lead.id}`,
          data: {
            disparador: "programado" as const,
            workflowId: vencido.workflowId,
            leadId: lead.id,
            ...(activa ? { leadSessionId: sesion.id } : {}),
            contexto: contextoDeDisparo({ lead, sesion, canal: lead.canal_origen }),
          },
        },
      ];
    });
}

function envolverNoRetriable<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((error: unknown) => {
    if (isNonRetriable(error)) {
      throw new NonRetriableError((error as Error).message, { cause: error });
    }
    throw error;
  });
}

export function makeWorkflowProgramadosFn(deps: WorkflowProgramadosDeps) {
  return inngest.createFunction(
    {
      id: "workflow-programados",
      // Un tick a la vez: dos revisando la misma ventana sólo duplican trabajo
      // (el `id` de cada disparo ya evita la corrida doble).
      concurrency: { limit: 1 },
      triggers: [{ cron: CRON_PROGRAMADOS }, { event: workflowProgramadosRevisar }],
    },
    async ({ event, step }) => {
      const logger = (deps.logger ?? new NoopLogger()).child({ workflow: "workflow-programados" });
      // La hora del evento y no `new Date()`: un reintento de este run mira la
      // misma ventana y arma los mismos nombres de step.
      const ahora = new Date(event.ts ?? Date.now());
      const tick = claveDeTick(ahora);

      const { vencidos, errores } = await step.run(`workflow-programados-${tick}-vencidos`, () =>
        envolverNoRetriable(() => programadosVencidos(ahora, deps)),
      );
      for (const e of errores) {
        logger.warn("programado-sin-horario-valido", { workflow_id: e.workflowId, error: e.error });
      }

      let disparados = 0;
      for (const vencido of vencidos) {
        const base = `workflow-programados-${vencido.franja}-${vencido.workflowId}`;
        const disparos = await step.run(`${base}-audiencia`, () =>
          envolverNoRetriable(() => disparosProgramados(vencido, ahora, deps)),
        );
        for (const [i, lote] of enLotes(disparos).entries()) {
          await step.sendEvent(`${base}-envio-${i}`, comoEventos(lote));
        }
        disparados += disparos.length;
        logger.info("programado-disparado", {
          workflow_id: vencido.workflowId,
          franja: vencido.franja,
          leads: disparos.length,
        });
      }

      return { vencidos: vencidos.length, disparados, errores: errores.length };
    },
  );
}
