"use server";

import { getLogger } from "@/lib/observability/get-logger";
import { MarcarNotificacionLeidaSchema } from "@/lib/validation/notificaciones.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getNotificacionesServiceForRequest } from "@/server/bootstrap/notificaciones-bootstrap";
import type { ActionResult } from "@/types/inbox";
import type { PanelNotificaciones } from "@/types/notificaciones";

const logger = getLogger({ scope: "notificaciones-actions" });

/**
 * Los avisos de quien mira. La usa la campanita del panel al abrirse y cada vez
 * que Realtime avisa de uno nuevo. `null` = no se pudieron leer: la campanita
 * se queda con lo que tenía en vez de vaciarse.
 */
export async function leerNotificacionesAction(): Promise<PanelNotificaciones | null> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return null;
    const svc = await getNotificacionesServiceForRequest();
    return await svc.panel(user.id);
  } catch (e) {
    logger.warn("no se pudieron leer las notificaciones", { error_name: (e as Error).name });
    return null;
  }
}

export async function marcarNotificacionLeidaAction(raw: unknown): Promise<ActionResult> {
  const parsed = MarcarNotificacionLeidaSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Aviso inválido." };
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    const svc = await getNotificacionesServiceForRequest();
    await svc.marcarLeida(user.id, parsed.data.id);
    return { ok: true };
  } catch (e) {
    logger.warn("no se pudo marcar el aviso", { error_name: (e as Error).name });
    return { ok: false, error: "No se pudo marcar el aviso. Probá de nuevo." };
  }
}

export async function marcarTodasLeidasAction(): Promise<ActionResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    const svc = await getNotificacionesServiceForRequest();
    await svc.marcarTodasLeidas(user.id);
    return { ok: true };
  } catch (e) {
    logger.warn("no se pudieron marcar los avisos", { error_name: (e as Error).name });
    return { ok: false, error: "No se pudieron marcar los avisos. Probá de nuevo." };
  }
}
