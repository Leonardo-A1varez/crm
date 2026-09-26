import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseNotificacionesRepository } from "@/server/repositories/notificaciones.supabase.repo";
import { NotificacionesService } from "@/server/services/notificaciones.service";
import type { AppClient } from "@/server/db/client";

/** Composición pura sobre un client dado. */
export function makeNotificacionesService(db: AppClient): NotificacionesService {
  return new NotificacionesService(new SupabaseNotificacionesRepository(db));
}

/** Panel: con el client authed del request, donde la RLS deja ver solo las propias. */
export async function getNotificacionesServiceForRequest(): Promise<NotificacionesService> {
  return makeNotificacionesService(await createSupabaseServerClient());
}
