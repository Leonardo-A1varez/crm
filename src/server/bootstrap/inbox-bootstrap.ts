import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { defaultDbClientFactory } from "@/server/db/client";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
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
  cached = new DefaultInboxService({
    leads: new SupabaseLeadsRepository(db),
    sessions: new SupabaseLeadSessionRepository(db),
    convs: new SupabaseConversationsRepository(db),
    messages: new SupabaseMessagesRepository(db),
  });
  return cached;
}
