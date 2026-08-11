import { PanelLista } from "@/components/inbox/PanelLista";
import { RefreshPoller } from "@/components/shared/RefreshPoller";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { buscarConversacionesAction } from "./_actions/buscar-conversaciones.action";

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
  // El catálogo de etiquetas viaja con el layout y no con cada búsqueda: los
  // chips de filtro tienen que estar poblados antes de la primera letra, y el
  // catálogo no cambia mientras alguien tipea.
  const [items, etiquetas] = await Promise.all([svc.listActiveLeads(), svc.listEtiquetas()]);

  return (
    // El scroll horizontal tiene que vivir acá y no en el `<main>` del panel:
    // ese `<main>` es `min-w-0 overflow-hidden` y clipea sin barra, así que por
    // debajo de 1164px el Twin quedaba cortado y no había forma de alcanzarlo.
    // Dárselo al `<main>` haría que cualquier tabla ancha de las otras 6
    // pantallas empujara el shell entero.
    <div className="h-full overflow-x-auto">
      <div className="flex h-full min-w-[1164px]">
        <PanelLista items={items} etiquetas={etiquetas} buscar={buscarConversacionesAction} />
        <div className="flex min-w-[520px] flex-1 overflow-hidden">{children}</div>
      </div>
      <RefreshPoller intervalMs={5000} />
    </div>
  );
}
