import { SideNav } from "@/components/shared/SideNav";
import { rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { logoutAction } from "./_actions/logout.action";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();
  const email = user?.email ?? "";
  const nombre = email.split("@")[0] ?? "Usuario";

  return (
    // overflow-x-auto: por debajo de ~1164px el layout scrollea horizontal en
    // vez de aplastarse. El diseño asume escritorio; no hay layout móvil.
    <div className="bg-surface-root flex h-screen overflow-x-auto overflow-y-hidden">
      <SideNav user={{ nombre, rol: rolFromUser(user) }} onLogout={logoutAction} />
      <main className="flex min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
