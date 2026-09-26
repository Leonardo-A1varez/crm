import { inngest } from "@/inngest/client";
import { makeEmitirDisparoWorkflow } from "@/inngest/callbacks/emit";
import { makeConversationsParaEnviarMensaje } from "@/inngest/callbacks/workflow-adapters";
import { workflowCorridaCancelada, workflowSegmentoPendiente } from "@/inngest/events";
import type { DisparoWorkflow } from "@/lib/workflows/disparos";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseAdminAuditRepository } from "@/server/repositories/admin-audit.supabase.repo";
import { SupabaseDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.supabase.repo";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseUsersRepository } from "@/server/repositories/users.supabase.repo";
import { SupabaseWorkflowRunsRepository } from "@/server/repositories/workflow-runs.supabase.repo";
import { SupabaseWorkflowsRepository } from "@/server/repositories/workflows.supabase.repo";
import { getLogger } from "@/lib/observability/get-logger";
import { SupabaseAgenteConfigRepository } from "@/server/repositories/agente-config.supabase.repo";
import { SupabaseCondicionWorkflowRepository } from "@/server/repositories/condicion-workflow.supabase.repo";
import { CachedAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { DefaultCorridasWorkflowService } from "@/server/services/workflows/corridas.service";
import { camposVivosDeCondicion } from "@/server/services/workflows/campos-vivos";
import {
  DefaultCondicionWorkflowService,
  type CondicionWorkflowService,
} from "@/server/services/workflows/condicion.service";
import { DefaultWorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";
import {
  makeVistaPreviaMensajeService,
  type VistaPreviaMensajeService,
} from "@/server/services/workflows/vista-previa.service";
import type { AppClient } from "@/server/db/client";
import type { WorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import type { ImagenesDeFlujoRepository } from "@/server/repositories/imagenes-de-flujo.repo";
import { SupabaseImagenesDeFlujoRepository } from "@/server/repositories/imagenes-de-flujo.supabase.repo";
import type {
  CorridasWorkflowService,
  EmitirCancelacion,
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
    // Las condiciones de la prueba leen intent, etiquetas y vehículo reales
    // (sólo lectura), igual que producción.
    camposVivos: camposVivosDeCondicion(
      new SupabaseCondicionWorkflowRepository(db),
      configDelAgente(db),
    ),
  });
}

/**
 * La config del agente con el client del request, para la zona del negocio.
 * Si no se puede leer cae a la de fábrica y lo deja en el log
 * (`CachedAgentConfigProvider`).
 */
function configDelAgente(db: AppClient): CachedAgentConfigProvider {
  return new CachedAgentConfigProvider(
    new SupabaseAgenteConfigRepository(db),
    getLogger({ scope: "workflows" }),
  );
}

/**
 * La pantalla de condición: catálogos (intents, etiquetas) y cuántos leads
 * coinciden. Con el client del request: RLS decide qué leads se cuentan.
 */
export async function getCondicionWorkflowServiceForRequest(): Promise<CondicionWorkflowService> {
  const db = await createSupabaseServerClient();
  return new DefaultCondicionWorkflowService({
    repo: new SupabaseCondicionWorkflowRepository(db),
    config: configDelAgente(db),
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

/**
 * "Cancelar corrida": `workflow-segmento` lo tiene en `cancelOn` y corta el
 * segmento dormido de esa corrida. Una sola cancelación por corrida (el CAS de
 * la base): el `id` por corrida sólo deduplica la reentrega del envío.
 */
const emitirCancelacion: EmitirCancelacion = async (runId) => {
  await inngest.send({
    name: workflowCorridaCancelada.name,
    data: { runId },
    id: `workflow-corrida-cancelada:${runId}`,
  });
};

export function makeCorridasWorkflowService(db: AppClient): CorridasWorkflowService {
  return new DefaultCorridasWorkflowService({
    workflows: new SupabaseWorkflowsRepository(db),
    runs: new SupabaseWorkflowRunsRepository(db),
    leads: new SupabaseLeadsRepository(db),
    vehiculos: new SupabaseLeadVehiculosRepository(db),
    messages: new SupabaseMessagesRepository(db),
    emitirSegmento,
    emitirCancelacion,
    // Con el client del request: `admin_actions` sólo admite INSERT de un admin.
    audit: new DefaultAdminAuditService(new SupabaseAdminAuditRepository(db)),
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

/**
 * La vista previa de «Enviar mensaje» del editor. Con el client del request:
 * RLS decide qué lead se puede leer. La conversación y la ventana de 24 h
 * salen del mismo adaptador que usa la acción del motor
 * (`makeConversationsParaEnviarMensaje`), que por eso se arma acá y no en el
 * servicio (`server/services/**` no importa `src/inngest/**`).
 */
export async function getVistaPreviaMensajeServiceForRequest(): Promise<VistaPreviaMensajeService> {
  const db = await createSupabaseServerClient();
  return makeVistaPreviaMensajeService({
    leads: new SupabaseLeadsRepository(db),
    sessions: new SupabaseLeadSessionRepository(db),
    users: new SupabaseUsersRepository(db),
    conversaciones: makeConversationsParaEnviarMensaje({
      conversations: new SupabaseConversationsRepository(db),
      messages: new SupabaseMessagesRepository(db),
    }),
  });
}

/**
 * Las imágenes del bloque "Enviar imagen", con el client del request: la
 * policy de Storage deja subir sólo a un admin, y sólo bajo `flujos/`.
 */
export async function getImagenesDeFlujoRepoForRequest(): Promise<ImagenesDeFlujoRepository> {
  const db = await createSupabaseServerClient();
  return new SupabaseImagenesDeFlujoRepository(db);
}
