"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Users, Package, Tag, Workflow, BarChart3, Settings } from "lucide-react";
import type { ComponentType } from "react";

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

const ITEMS: readonly NavItem[] = [
  { href: "/inbox", label: "Inbox", Icon: Inbox },
  { href: "/leads", label: "Leads", Icon: Users },
  { href: "/productos", label: "Productos", Icon: Package },
  { href: "/intents-reglas", label: "Intents y reglas", Icon: Workflow },
  { href: "/tags", label: "Tags", Icon: Tag },
  { href: "/metricas", label: "Métricas", Icon: BarChart3 },
  { href: "/ajustes", label: "Ajustes", Icon: Settings },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-1 p-2">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors " +
              (active
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground")
            }
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
