import { env } from "@/lib/env";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { defaultDbClientFactory } from "@/server/db/client";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { GraphApiMetaClient } from "@/server/services/meta/graph-api-client";
import type { InboxService } from "@/server/services/inbox/inbox.service";

/**
 * Construye InboxService real con repos Supabase service-role.
 *
 * Pre-Slice 3 (sin auth) usa service-role; cuando Slice 3 introduzca authed
 * client, swap a `dbFactory.authed(token)` aquí (1 línea).
 *
 * Singleton module-scope: 1 InboxService reusado entre requests RSC (Supabase
 * client maneja pool de conexiones).
 */
let cached: InboxService | null = null;

export function getInboxService(): InboxService {
  if (cached) return cached;
  const db = defaultDbClientFactory().serviceRole();
  const convs = new SupabaseConversationsRepository(db);
  const messages = new SupabaseMessagesRepository(db);
  const sessions = new SupabaseLeadSessionRepository(db);

  // Mismo wireup Meta que inngest/bootstrap.ts: canal sin config → ValidationError
  // fail-fast con envHint al primer send (no al construir).
  const metaClient = new GraphApiMetaClient({
    graphApiVersion: env.META_GRAPH_API_VERSION,
    whatsappPhoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID,
    whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
    igPageId: env.META_IG_PAGE_ID,
    igAccessToken: env.META_IG_ACCESS_TOKEN,
    fbPageId: env.META_FB_PAGE_ID,
    fbAccessToken: env.META_FB_PAGE_ACCESS_TOKEN,
  });

  cached = new DefaultInboxService({
    leads: new SupabaseLeadsRepository(db),
    sessions,
    convs,
    messages,
    metaApi: new DefaultMetaApiService(convs, messages, metaClient),
    handoff: new DefaultHandoffService(sessions),
  });
  return cached;
}
