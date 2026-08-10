"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanTool } from "@/components/icons";
import { ChannelDot } from "@/components/shared/ChannelDot";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { StageBadge } from "@/components/shared/StageBadge";
import { cn } from "@/lib/utils";
import type { Prioridad } from "@/types/domain";
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

const CHIP_PRIORIDAD: Record<Prioridad, string> = {
  alta: "text-danger bg-danger/13",
  media: "text-caution bg-caution/13",
  baja: "text-ink-dim bg-surface-avatar",
};

export function InboxListItem({ item }: { item: InboxItem }) {
  const pathname = usePathname();
  const isActive = pathname === `/inbox/${item.leadId}`;

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
        {item.canalActivo ? (
          <ChannelDot
            canal={item.canalActivo}
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
          <div className="flex shrink-0 items-center gap-1.5">
            <MonoMeta>{formatRelative(item.ultimaActividad)}</MonoMeta>
            {item.sinResponder > 0 ? (
              <span
                className="bg-brand text-brand-ink inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 font-mono text-[9.5px] font-bold"
                aria-label={`${item.sinResponder} sin responder`}
              >
                {item.sinResponder}
              </span>
            ) : null}
          </div>
        </div>
        <p className="text-ink-dim mt-0.5 truncate text-[11.5px]">
          {item.ultimoMensaje
            ? `${item.ultimoMensaje.direction === "out" ? "Vos: " : ""}${item.ultimoMensaje.body}`
            : "Sin mensajes"}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <StageBadge stage={item.currentStage} />
          {item.motivo ? (
            <span
              className={cn(
                "inline-flex min-w-0 items-center gap-1 rounded-md px-[7px] py-[2.5px] text-[10px] font-semibold",
                CHIP_PRIORIDAD[item.prioridad],
              )}
            >
              {item.iaPausada ? <PanTool size={12} className="shrink-0" /> : null}
              <span className="truncate">{item.motivo}</span>
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
