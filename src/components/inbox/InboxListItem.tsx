import Link from "next/link";
import { ChannelDot } from "@/components/shared/ChannelDot";
import { StageBadge } from "@/components/shared/StageBadge";
import { Badge } from "@/components/ui/badge";
import type { InboxItem } from "@/types/inbox";

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
  return (
    <Link
      href={`/inbox/${item.leadId}`}
      className="hover:bg-accent border-border block border-b px-4 py-3 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate font-medium">{item.nombre}</span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {formatRelative(item.ultimaActividad)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-muted-foreground flex-1 truncate text-sm">
          {item.ultimoMensaje
            ? `${item.ultimoMensaje.direction === "out" ? "Vos: " : ""}${item.ultimoMensaje.body}`
            : "Sin mensajes"}
        </p>
        <div className="flex items-center gap-1">
          {item.canales.map((c) => (
            <ChannelDot key={c} canal={c} size={8} />
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <StageBadge stage={item.currentStage} />
        {item.iaPausada ? (
          <Badge variant="outline" className="text-xs">
            IA pausada
          </Badge>
        ) : null}
      </div>
    </Link>
  );
}
