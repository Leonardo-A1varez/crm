import { notFound } from "next/navigation";
import { ChatThread } from "@/components/inbox/ChatThread";
import { ConversationHeader } from "@/components/inbox/ConversationHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { NotFoundError } from "@/lib/errors";
import { getInboxService } from "@/server/bootstrap/inbox-bootstrap";
import type { ConversationView } from "@/types/inbox";

export const dynamic = "force-dynamic";

export default async function InboxLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;

  let view: ConversationView;
  try {
    view = await getInboxService().getConversation(leadId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  const lastMessage = view.messages[view.messages.length - 1];
  const ultimaActividadIso =
    lastMessage?.created_at.toISOString() ?? view.session?.started_at.toISOString() ?? null;

  return (
    <div className="flex h-screen flex-col">
      <ConversationHeader
        lead={view.lead}
        session={view.session}
        canales={view.canales}
        canalActivo={view.canalActivo}
        ultimaActividadIso={ultimaActividadIso}
      />
      <div className="flex-1 overflow-hidden">
        {view.session ? (
          <ChatThread messages={view.messages} />
        ) : (
          <EmptyState
            title="Sin sesión activa"
            description="La sesión de este lead fue cerrada. El historial se purga a los 29 días del cierre."
          />
        )}
      </div>
      {/* MessageInput llega en 8.4 (Server Actions write path) */}
    </div>
  );
}
