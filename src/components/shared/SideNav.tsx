"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import {
  BarChartIcon,
  Group,
  InboxIcon,
  Inventory2,
  Sell,
  SettingsIcon,
  SettingsSuggest,
  SmartToy,
} from "@/components/icons";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/types/inbox";
import type { ComponentType } from "react";

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
}

// Los siete ítems del handoff §1.1, en ese orden. "OpenAI settings" (/agente)
// es la consola que absorbió la administración de intents y reglas:
// /intents-reglas ya solo redirige a /agente?tab=reglas, así que no tiene ítem
// propio. El nombre lo eligió el dueño; nombra al proveedor y no a la función,
// así que si algún día se cambia de modelo hay que revisarlo.
const ITEMS: readonly NavItem[] = [
  { href: "/inbox", label: "Inbox", Icon: InboxIcon },
  { href: "/leads", label: "Leads", Icon: Group },
  { href: "/productos", label: "Productos", Icon: Inventory2 },
  { href: "/agente", label: "OpenAI settings", Icon: SmartToy },
  { href: "/tags", label: "Tags", Icon: Sell },
  { href: "/metricas", label: "Métricas", Icon: BarChartIcon },
  { href: "/ajustes", label: "Ajustes", Icon: SettingsIcon },
];

export function SideNav({
  user,
  onLogout,
  bandejaCount,
}: {
  user: { nombre: string; rol: string };
  onLogout: () => Promise<ActionResult>;
  bandejaCount?: number;
}) {
  const pathname = usePathname();

  return (
    <aside className="bg-surface-root border-line-layout flex h-full w-[222px] shrink-0 flex-col border-r">
      <div className="flex items-center gap-2.5 px-3.5 py-3.5">
        <span
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
          style={{
            background: "linear-gradient(145deg,var(--color-brand-hover),var(--color-brand-deep))",
            boxShadow: "0 4px 14px color-mix(in srgb, var(--color-brand-deep) 28%, transparent)",
          }}
        >
          <SettingsSuggest className="text-brand-ink" size={19} strokeWidth={1.75} />
        </span>
        <span className="min-w-0">
          <span className="text-ink-primary block truncate text-[13.5px] leading-tight font-[650] tracking-[-0.01em]">
            Repuestos
          </span>
          <span className="text-ink-faint block font-mono text-[9.5px] tracking-[0.13em] uppercase">
            CRM · single-org
          </span>
        </span>
      </div>

      {/* min-h-0 es obligatorio: sin él, el flex-1 del nav empuja el footer
          fuera del viewport en pantallas bajas. */}
      <nav
        aria-label="Navegación principal"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3"
      >
        {ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-[11px] rounded-[9px] px-2.5 py-2 text-[12.5px] transition-colors",
                active
                  ? "bg-surface-hover text-ink-primary font-semibold"
                  : "text-ink-dim hover:bg-surface-elevated hover:text-ink-primary font-medium",
              )}
            >
              {active ? (
                <span
                  aria-hidden
                  className="bg-brand absolute top-1/2 left-[-10px] h-[18px] w-[2.5px] -translate-y-1/2 rounded-r-[3px]"
                  style={{
                    boxShadow: "0 0 10px color-mix(in srgb, var(--color-brand) 70%, transparent)",
                  }}
                />
              ) : null}
              <Icon className="shrink-0" size={18} strokeWidth={1.5} />
              <span className="flex-1 truncate">{label}</span>
              {/* Cuenta las que requieren a una persona, no las activas: un
                  badge que marca todo lo que existe no dice nada. En cero no
                  se muestra. */}
              {href === "/inbox" && bandejaCount ? (
                <span className="bg-brand text-brand-ink rounded-full px-1.5 py-px font-mono text-[10px] font-semibold">
                  {bandejaCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-line-layout flex items-center gap-2.5 border-t px-3 py-3">
        <InitialsAvatar nombre={user.nombre} size={26} />
        <span className="min-w-0 flex-1">
          <span className="text-ink-primary block truncate text-[11.5px] font-[550]">
            {user.nombre}
          </span>
          <span className="text-ink-faint block truncate text-[10px]">{user.rol}</span>
        </span>
        <LogoutButton onLogout={onLogout} />
      </div>
    </aside>
  );
}
