import { PanelLista } from "@/components/inbox/PanelLista";
import { RefreshPoller } from "@/components/shared/RefreshPoller";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";

export const dynamic = "force-dynamic";

/**
 * Shell de 3 paneles. La lista vive acá y no en las páginas porque Next
 * preserva el layout al navegar entre rutas hermanas: seleccionar una
 * conversación actualiza los paneles 2 y 3 sin remontar la lista ni perder su
 * scroll. Es lo que el handoff pide ("seleccionar no navega") logrado con
 * routing normal, sin estado en cliente y sin romper el deep-linking.
 */
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const svc = await getInboxServiceForRequest();
  const items = await svc.listActiveLeads();

  return (
    <div className="flex h-full min-w-[1164px] flex-1 overflow-hidden">
      <PanelLista items={items} />
      <div className="flex min-w-[520px] flex-1 overflow-hidden">{children}</div>
      <RefreshPoller intervalMs={5000} />
    </div>
  );
}
