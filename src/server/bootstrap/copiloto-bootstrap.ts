import { inngest } from "@/inngest/client";
import { copilotoBorradorSolicitado } from "@/inngest/events";
import { getLogger } from "@/lib/observability/get-logger";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import type { AppClient } from "@/server/db/client";
import { SupabaseAgenteConfigRepository } from "@/server/repositories/agente-config.supabase.repo";
import { SupabaseBorradoresIaRepository } from "@/server/repositories/borradores-ia.supabase.repo";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseRulesRepository } from "@/server/repositories/rules.supabase.repo";
import { CachedAgentConfigProvider } from "@/server/services/agente/config-provider";
import {
  DefaultCopilotoService,
  type CopilotoService,
  type SolicitarRegeneracionFn,
} from "@/server/services/copiloto/copiloto.service";

/**
 * Encola "Regenerar / Reintentar". Vive acá y no en el servicio ni en la Server
 * Action porque `server/services/**` y `app/**` no pueden importar
 * `src/inngest/**` (boundaries): esta es la costura, igual que
 * `inbox-bootstrap.ts` con el recordatorio.
 *
 * El `id` es la deduplicación de Inngest: dos clics sobre la misma tarjeta son
 * un solo pedido. Tras regenerar el borrador es otro (otro id), así que una
 * segunda regeneración sí sale.
 */
const solicitarRegeneracion: SolicitarRegeneracionFn = async (input) => {
  await inngest.send({
    name: copilotoBorradorSolicitado.name,
    data: input,
    id: `copiloto-regenerar:${input.borradorId}`,
  });
};

/** Composición pura sobre un client dado (authed en el panel). */
export function makeCopilotoService(db: AppClient): CopilotoService {
  return new DefaultCopilotoService({
    borradores: new SupabaseBorradoresIaRepository(db),
    conversations: new SupabaseConversationsRepository(db),
    messages: new SupabaseMessagesRepository(db),
    rules: new SupabaseRulesRepository(db),
    configProvider: new CachedAgentConfigProvider(
      new SupabaseAgenteConfigRepository(db),
      getLogger({ scope: "copiloto" }),
    ),
    solicitarRegeneracion,
  });
}

/** El panel consume la DB con el client autenticado del request (RLS real). */
export async function getCopilotoServiceForRequest(): Promise<CopilotoService> {
  const db = await createSupabaseServerClient();
  return makeCopilotoService(db);
}
