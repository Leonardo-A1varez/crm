import { inngest } from "@/inngest/client";
import { makeEmitirDisparoWorkflow } from "@/inngest/callbacks/emit";
import { workflowSegmentoPendiente } from "@/inngest/events";
import type { DisparoWorkflow } from "@/lib/workflows/disparos";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseWorkflowRunsRepository } from "@/server/repositories/workflow-runs.supabase.repo";
import { SupabaseWorkflowsRepository } from "@/server/repositories/workflows.supabase.repo";
import { DefaultCorridasWorkflowService } from "@/server/services/workflows/corridas.service";
import { DefaultWorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";
import type { AppClient } from "@/server/db/client";
import type { WorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import type {
  CorridasWorkflowService,
  EmitirSegmento,
} from "@/server/services/workflows/corridas.service";
import type { WorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";

export function makeWorkflowsAdminService(db: AppClient): WorkflowsAdminService {
  return new DefaultWorkflowsAdminService({
    workflows: new SupabaseWorkflowsRepository(db),
    workflowRuns: new SupabaseWorkflowRunsRepository(db),
    leads: new SupabaseLeadsRepository(db),
    // "Probar" lee la sesion activa real y la lista de bajas real para que los
    // topes de seguridad salten igual que en produccion (requiere humano,
    // dado de baja). Solo lectura: los efectos siguen interceptados.
    sessions: new SupabaseLeadSessionRepository(db),
    supresiones: new SupabaseDifusionSupresionesRepository(db),
  });
}

export async function getWorkflowsAdminServiceForRequest(): Promise<WorkflowsAdminService> {
  const db = await createSupabaseServerClient();
  return makeWorkflowsAdminService(db);
}

export async function getWorkflowRunsRepoForRequest(): Promise<WorkflowRunsRepository> {
  const db = await createSupabaseServerClient();
  return new SupabaseWorkflowRunsRepository(db);
}

/**
 * Encola un segmento en Inngest, el mismo evento que encadena el motor.
 *
 * Vive acá y no en el servicio porque `server/services/**` no puede importar
 * `src/inngest/**` (boundaries): este bootstrap es la costura, igual que
 * `programarAvisoRecordatorio` en `inbox-bootstrap.ts`. El `id` —la clave de
 * deduplicación de Inngest— lo decide el servicio.
 */
const emitirSegmento: EmitirSegmento = async ({ runId, desdePaso, id }) => {
  await inngest.send({
    // El nombre del `eventType` que registra el trigger de `workflow-segmento`,
    // importado para que no pueda desalinearse sin que alguien lo note.
    name: workflowSegmentoPendiente.name,
    data: { runId, desdePaso },
    id,
  });
};

export function makeCorridasWorkflowService(db: AppClient): CorridasWorkflowService {
  return new DefaultCorridasWorkflowService({
    workflows: new SupabaseWorkflowsRepository(db),
    runs: new SupabaseWorkflowRunsRepository(db),
    leads: new SupabaseLeadsRepository(db),
    messages: new SupabaseMessagesRepository(db),
    emitirSegmento,
  });
}

/**
 * Con el client del request: reanudar y relanzar autorizan con `is_admin()` en
 * la base, y RLS decide qué corrida se ve.
 */
export async function getCorridasWorkflowServiceForRequest(): Promise<CorridasWorkflowService> {
  const db = await createSupabaseServerClient();
  return makeCorridasWorkflowService(db);
}

/**
 * Manda `workflow/disparo.recibido` desde el panel: el disparo manual y los
 * cambios que una persona hace a mano (etiquetas, etapa). Misma costura que
 * `emitirSegmento`: `app/**` no puede importar `src/inngest/**`. El `id` —la
 * deduplicación— lo arma quien construye el disparo (`lib/workflows/disparos`).
 */
export const emitirDisparoWorkflow: (disparo: DisparoWorkflow) => Promise<void> =
  makeEmitirDisparoWorkflow(inngest);
