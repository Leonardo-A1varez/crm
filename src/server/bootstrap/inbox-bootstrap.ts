import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseProductsRepository } from "@/server/repositories/productos.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { GraphApiMetaClient } from "@/server/services/meta/graph-api-client";
import type { AppClient } from "@/server/db/client";
import type { InboxService } from "@/server/services/inbox/inbox.service";

/** Composición pura del service sobre un client dado (authed o service-role en tests). */
export function makeInboxService(db: AppClient): InboxService {
  const convs = new SupabaseConversationsRepository(db);
  const messages = new SupabaseMessagesRepository(db);
  const sessions = new SupabaseLeadSessionRepository(db);

  // Canal sin config → ValidationError fail-fast con envHint al primer send.
  const metaClient = new GraphApiMetaClient({
    graphApiVersion: env.META_GRAPH_API_VERSION,
    whatsappPhoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID,
    whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
    igPageId: env.META_IG_PAGE_ID,
    igAccessToken: env.META_IG_ACCESS_TOKEN,
    fbPageId: env.META_FB_PAGE_ID,
    fbAccessToken: env.META_FB_PAGE_ACCESS_TOKEN,
  });

  return new DefaultInboxService({
    leads: new SupabaseLeadsRepository(db),
    sessions,
    convs,
    messages,
    metaApi: new DefaultMetaApiService(convs, messages, metaClient),
    handoff: new DefaultHandoffService(sessions),
    productos: new SupabaseProductsRepository(db),
    tags: new SupabaseTagsRepository(db),
  });
}

/**
 * Slice 3: el panel consume la DB con el client authed del request (RLS real).
 * Un service nuevo por request — construcción barata, el pool vive en PostgREST.
 * Inngest/webhooks siguen con service-role vía su propio bootstrap (7.8).
 */
export async function getInboxServiceForRequest(): Promise<InboxService> {
  const db = await createSupabaseServerClient();
  return makeInboxService(db);
}
