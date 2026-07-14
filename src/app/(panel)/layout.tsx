import { SideNav } from "@/components/shared/SideNav";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { logoutAction } from "./_actions/logout.action";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-56 flex-col border-r">
        <div className="border-sidebar-border border-b p-4">
          <span className="text-base font-semibold">CRM Repuestos</span>
        </div>
        <div className="flex-1">
          <SideNav />
        </div>
        <div className="border-sidebar-border border-t p-2">
          {user?.email ? (
            <p className="text-muted-foreground truncate px-3 pb-1 text-xs">{user.email}</p>
          ) : null}
          <LogoutButton onLogout={logoutAction} />
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
