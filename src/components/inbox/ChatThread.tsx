import { EmptyState } from "@/components/shared/EmptyState";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import type { Mensaje } from "@/types/entities";

/**
 * Thread de mensajes anclado al fondo sin JS: `flex-col-reverse` + array
 * invertido (recibe ASC). Server component.
 */
export function ChatThread({ messages }: { messages: Mensaje[] }) {
  if (messages.length === 0) {
    return (
      <EmptyState
        title="Sin mensajes"
        description="Esta sesión todavía no tiene mensajes registrados."
      />
    );
  }
  const reversed = [...messages].reverse();
  return (
    <div className="flex h-full flex-col-reverse gap-2 overflow-y-auto px-4 py-3">
      {reversed.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </div>
  );
}
