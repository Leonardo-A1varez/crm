import { SideNav } from "@/components/shared/SideNav";
import { rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { getNotificacionesServiceForRequest } from "@/server/bootstrap/notificaciones-bootstrap";
import { logoutAction } from "./_actions/logout.action";
import {
  leerNotificacionesAction,
  marcarNotificacionLeidaAction,
  marcarTodasLeidasAction,
} from "./_actions/notificaciones.actions";
import type { PanelNotificaciones } from "@/types/notificaciones";

/**
 * Badge de la Bandeja. Se traga el error a propósito: este layout envuelve las
 * 7 pantallas del panel y un contador caído no puede dejar sin Métricas ni sin
 * Ajustes a nadie. Sin número, el ítem de nav simplemente no muestra badge.
 */
async function contarBandeja(): Promise<number | undefined> {
  try {
    const svc = await getInboxServiceForRequest();
    return await svc.contarRequierenAtencion();
  } catch {
    return undefined;
  }
}

/** Los avisos de quien mira. Mismo criterio que el badge: un fallo no tumba el panel. */
async function leerAvisos(usuarioId: string | null): Promise<PanelNotificaciones | null> {
  if (usuarioId === null) return null;
  try {
    const svc = await getNotificacionesServiceForRequest();
    return await svc.panel(usuarioId);
  } catch {
    return null;
  }
}

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();
  const email = user?.email ?? "";
  // split("@")[0] de un string vacío da "" (nunca null/undefined), así que ??
  // no dispara el fallback: hace falta || para cubrir el caso sin email.
  const nombre = email.split("@")[0] || "Usuario";
  const usuarioId = user?.id ?? null;
  const [bandejaCount, avisos] = await Promise.all([contarBandeja(), leerAvisos(usuarioId)]);

  return (
    // overflow-x-auto: por debajo de ~1164px el layout scrollea horizontal en
    // vez de aplastarse. El diseño asume escritorio; no hay layout móvil.
    <div className="bg-surface-root flex h-screen overflow-x-auto overflow-y-hidden">
      <SideNav
        user={{ nombre, rol: rolFromUser(user) }}
        onLogout={logoutAction}
        bandejaCount={bandejaCount}
        avisos={{
          usuarioId,
          inicial: avisos,
          onLeer: leerNotificacionesAction,
          onMarcarLeida: marcarNotificacionLeidaAction,
          onMarcarTodas: marcarTodasLeidasAction,
        }}
      />
      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
