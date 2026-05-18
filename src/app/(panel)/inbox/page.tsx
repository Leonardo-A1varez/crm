import { InboxList } from "@/components/inbox/InboxList";
import { getInboxService } from "@/server/bootstrap/inbox-bootstrap";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const items = await getInboxService().listActiveLeads();
  return (
    <div className="flex h-screen flex-col">
      <header className="border-border border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Bandeja</h1>
      </header>
      <div className="flex-1 overflow-hidden">
        <InboxList items={items} />
      </div>
    </div>
  );
}
