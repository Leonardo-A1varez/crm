import { ChannelTabs } from "@/components/inbox/ChannelTabs";
import { InboxList } from "@/components/inbox/InboxList";
import { RefreshPoller } from "@/components/shared/RefreshPoller";
import { CanalSchema } from "@/lib/validation/schemas";
import { getInboxService } from "@/server/bootstrap/inbox-bootstrap";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ canal?: string }>;
}) {
  const params = await searchParams;
  // Param inválido (?canal=sms) → sin filtro, no error.
  const canalParse = CanalSchema.safeParse(params.canal);
  const canal = canalParse.success ? canalParse.data : null;

  const items = await getInboxService().listActiveLeads();
  const filtered = canal ? items.filter((i) => i.canales.includes(canal)) : items;

  return (
    <div className="flex h-screen flex-col">
      <header className="border-border border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Bandeja</h1>
      </header>
      <ChannelTabs active={canal} />
      <div className="flex-1 overflow-hidden">
        <InboxList items={filtered} />
      </div>
      <RefreshPoller intervalMs={5000} />
    </div>
  );
}
