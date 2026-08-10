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
    <div
      className="bg-surface-chat flex h-full flex-1 flex-col-reverse gap-[9px] overflow-y-auto px-[26px] py-5"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,.03) 1px, transparent 0)",
        backgroundSize: "24px 24px",
      }}
    >
      {reversed.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </div>
  );
}
