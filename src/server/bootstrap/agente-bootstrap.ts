import { getLogger } from "@/lib/observability/get-logger";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseAdminAuditRepository } from "@/server/repositories/admin-audit.supabase.repo";
import { SupabaseAgenteConfigRepository } from "@/server/repositories/agente-config.supabase.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import {
  DefaultAgenteConfigService,
  type AgenteConfigAuditPort,
} from "@/server/services/agente/agente-config.service";
import { CachedAgentConfigProvider } from "@/server/services/agente/config-provider";
import type { AppClient } from "@/server/db/client";
import type { AdminAuditService } from "@/server/services/admin-audit.service";
import type { AgenteConfigService } from "@/server/services/agente/agente-config.service";

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
