import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { DefaultBusquedaService } from "@/server/services/busqueda/default-busqueda.service";
import type { AppClient } from "@/server/db/client";
import type { BusquedaService } from "@/server/services/busqueda/busqueda.service";

/** Composición pura sobre un client dado (authed en el panel, service-role en tests). */
export function makeBusquedaService(db: AppClient): BusquedaService {
  return new DefaultBusquedaService({
    leads: new SupabaseLeadsRepository(db),
    sessions: new SupabaseLeadSessionRepository(db),
    messages: new SupabaseMessagesRepository(db),
    tags: new SupabaseTagsRepository(db),
  });
}

/**
 * El buscador consulta con el client authed del request: RLS decide qué
 * mensajes ve cada vendedor. Nunca con service-role — service-role bypassa RLS
 * y este es el único lugar del panel que lee el texto de TODAS las
 * conversaciones, incluidas las cerradas.
 */
export async function getBusquedaServiceForRequest(): Promise<BusquedaService> {
  const db = await createSupabaseServerClient();
  return makeBusquedaService(db);
}
