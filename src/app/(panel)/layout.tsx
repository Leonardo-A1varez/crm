import { SideNav } from "@/components/shared/SideNav";
import { rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { logoutAction } from "./_actions/logout.action";

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

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();
  const email = user?.email ?? "";
  // split("@")[0] de un string vacío da "" (nunca null/undefined), así que ??
  // no dispara el fallback: hace falta || para cubrir el caso sin email.
  const nombre = email.split("@")[0] || "Usuario";
  const bandejaCount = await contarBandeja();

  return (
    // overflow-x-auto: por debajo de ~1164px el layout scrollea horizontal en
    // vez de aplastarse. El diseño asume escritorio; no hay layout móvil.
    <div className="bg-surface-root flex h-screen overflow-x-auto overflow-y-hidden">
      <SideNav
        user={{ nombre, rol: rolFromUser(user) }}
        onLogout={logoutAction}
        bandejaCount={bandejaCount}
      />
      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
