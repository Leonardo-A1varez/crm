import { SideNav } from "@/components/shared/SideNav";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border w-56 border-r">
        <div className="border-sidebar-border border-b p-4">
          <span className="text-base font-semibold">CRM Repuestos</span>
        </div>
        <SideNav />
      </aside>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
