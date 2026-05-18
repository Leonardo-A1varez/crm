import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { InboxItem } from "@/types/inbox";
import { InboxListItem } from "./InboxListItem";

export function InboxList({ items }: { items: InboxItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Esperando primer mensaje"
        description="Cuando llegue un mensaje vía WhatsApp, Instagram o Facebook, aparecerá acá. Verificá que el webhook Meta esté configurado."
        icon={<Inbox className="h-10 w-10" />}
      />
    );
  }
  return (
    <ScrollArea className="h-full">
      <ul aria-label="Bandeja de conversaciones">
        {items.map((item) => (
          <li key={item.leadId}>
            <InboxListItem item={item} />
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
