"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanTool } from "@/components/icons";
import { ChannelDot } from "@/components/shared/ChannelDot";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { StageBadge } from "@/components/shared/StageBadge";
import { cn } from "@/lib/utils";
import type { InboxItem } from "@/types/inbox";

/** Timestamp compacto para la fila: "ahora" / "3m" / "2h" / "1d". */
function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

export function InboxListItem({ item }: { item: InboxItem }) {
  const pathname = usePathname();
  const isActive = pathname === `/inbox/${item.leadId}`;
  // `canales` es un set deduplicado sin orden significativo (ver
  // default-inbox.service.ts) — no hay campo "canal del último mensaje" en
  // InboxItem. Se usa el primero solo como referencia visual del avatar.
  const canalPrincipal = item.canales[0];

  return (
    <Link
      href={`/inbox/${item.leadId}`}
      className={cn(
        "relative flex items-start gap-2.5 rounded-[12px] p-[11px] transition-colors",
        isActive ? "bg-surface-hover" : "hover:bg-surface-elevated",
      )}
    >
      {isActive ? (
        <span
          aria-hidden
          className="bg-brand absolute inset-y-0 left-0 w-[2.5px] rounded-r-[3px]"
        />
      ) : null}

      <div className="relative shrink-0">
        <InitialsAvatar nombre={item.nombre} size={38} />
        {canalPrincipal ? (
          <ChannelDot
            canal={canalPrincipal}
            size={13}
            ringColor="var(--color-surface-panel)"
            className="absolute right-[-2px] bottom-[-2px]"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-ink-primary truncate text-[12.5px] font-semibold">
            {item.nombre}
          </span>
          <MonoMeta className="shrink-0">{formatRelative(item.ultimaActividad)}</MonoMeta>
        </div>
        <p className="text-ink-dim mt-0.5 truncate text-[11.5px]">
          {item.ultimoMensaje
            ? `${item.ultimoMensaje.direction === "out" ? "Vos: " : ""}${item.ultimoMensaje.body}`
            : "Sin mensajes"}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <StageBadge stage={item.currentStage} />
          {item.iaPausada ? (
            <span className="text-danger bg-danger/13 inline-flex items-center gap-1 rounded-md px-[7px] py-[2.5px] text-[10px] font-semibold">
              <PanTool size={12} />
              IA pausada
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
