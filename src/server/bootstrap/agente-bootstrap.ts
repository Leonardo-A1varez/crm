import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/lib/env";
import { OPENAI_PRICING } from "@/lib/agente/modelos";
import { getLogger } from "@/lib/observability/get-logger";
import { makeCostTracker } from "@/lib/observability/upstash-cost-tracker";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseAdminAuditRepository } from "@/server/repositories/admin-audit.supabase.repo";
import { SupabaseAgenteConfigRepository } from "@/server/repositories/agente-config.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseProductsRepository } from "@/server/repositories/productos.supabase.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import {
  DefaultAgenteConfigService,
  type AgenteConfigAuditPort,
} from "@/server/services/agente/agente-config.service";
import { CachedAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultAgentePreviewService } from "@/server/services/agente/preview.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { OpenAiAgentLLM } from "@/server/services/llm/openai-ai-agent";
import type { AppClient } from "@/server/db/client";
import type { AdminAuditService } from "@/server/services/admin-audit.service";
import type { AgenteConfigService } from "@/server/services/agente/agente-config.service";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import type { AgentePreviewService } from "@/server/services/agente/preview.service";

/**
 * Adapta `AdminAuditService` (`recordAction`, camelCase) al puerto angosto
 * que pide `DefaultAgenteConfigService` (`record`, snake_case en las claves
 * de la entidad). El servicio de config no conoce `AdminAuditService`
 * directamente para no acoplarse a una interfaz más ancha de la que necesita.
 */
function adaptarAudit(admin: AdminAuditService): AgenteConfigAuditPort {
  return {
    async record(input) {
      await admin.recordAction({
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entity_type,
        entityId: input.entity_id,
        payload: input.payload as Record<string, unknown> | undefined,
      });
    },
  };
}

/** Composición pura (authed o service-role en tests). */
export function makeAgenteConfigService(db: AppClient): AgenteConfigService {
  const logger = getLogger({ scope: "agente-config" });

  return new DefaultAgenteConfigService({
    repo: new SupabaseAgenteConfigRepository(db),
    audit: adaptarAudit(new DefaultAdminAuditService(new SupabaseAdminAuditRepository(db))),
    configProvider: new CachedAgentConfigProvider(new SupabaseAgenteConfigRepository(db), logger),
  });
}

/** Panel: client authed del request (RLS real). Uno por request. */
export async function getAgenteConfigServiceForRequest(): Promise<AgenteConfigService> {
  return makeAgenteConfigService(await createSupabaseServerClient());
}

/**
 * Panel: preview de una config candidata (Task 11). Arma repos + cost
 * tracker + LLM acá porque `app/**` no puede importar `server-repositories`
 * directamente (zonas ESLint, ver `eslint.config.mjs`) — la Server Action
 * solo conoce el service, igual que con `getAgenteConfigServiceForRequest`.
 *
 * `workflow: "agente-preview"` en el `OpenAiAgentLLM` es lo que separa este
 * gasto del de producción ("ai-agent") en el reporte de costos — sin eso un
 * preview gratis en las cuentas sería un agujero en el control de gasto.
 */
export async function getAgentePreviewServiceForRequest(): Promise<AgentePreviewService> {
  const db = await createSupabaseServerClient();
  const logger = getLogger({ scope: "agente-preview" });

  const costTracker = makeCostTracker({
    pricing: OPENAI_PRICING,
    dailyCapUsd: env.LLM_DAILY_CAP_USD,
    upstashUrl: env.UPSTASH_REDIS_REST_URL,
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN,
    logger,
  });
  const openaiProvider = createOpenAI({ apiKey: env.OPENAI_API_KEY });

  return new DefaultAgentePreviewService(
    new SupabaseLeadSessionRepository(db),
    new SupabaseMessagesRepository(db),
    new DefaultCatalogMatcherService(new SupabaseProductsRepository(db)),
    (configProvider: AgentConfigProvider) =>
      new OpenAiAgentLLM({
        provider: openaiProvider,
        configProvider,
        costTracker,
        workflow: "agente-preview",
        logger,
      }),
  );
}
