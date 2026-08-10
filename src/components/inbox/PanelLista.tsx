import { InboxList } from "@/components/inbox/InboxList";
import type { InboxItem } from "@/types/inbox";

/**
 * Placeholder mínimo (Task 1). Solo envuelve el InboxList existente en la
 * columna de 322px del shell para poder verificarlo de punta a punta. La
 * Task 2 lo reemplaza por el panel real (buscador, filtros por canal, etc).
 */
export function PanelLista({ items }: { items: InboxItem[] }) {
  return (
    <div className="border-line-layout flex w-[322px] shrink-0 flex-col overflow-hidden border-r">
      <InboxList items={items} />
    </div>
  );
}
