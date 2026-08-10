"use client";

import { useSearchParams } from "next/navigation";
import { FiltrosCanal, parseCanalFilter } from "@/components/inbox/FiltrosCanal";
import { InboxListItem } from "@/components/inbox/InboxListItem";
import { InboxIcon } from "@/components/icons";
import { EmptyState } from "@/components/shared/EmptyState";
import { MonoMeta } from "@/components/shared/MonoMeta";
import type { InboxItem } from "@/types/inbox";

/**
 * Panel de lista (322px): encabezado con contador e indicador en vivo,
 * filtros de canal y filas. `items` llega ya cargado del layout (Server
 * Component); el filtro por canal se aplica acá en cliente sobre ese mismo
 * arreglo porque los layouts de Next no reciben `searchParams` — releer la
 * URL en cliente evita re-fetchear la lista completa por cada click de chip.
 */
export function PanelLista({ items }: { items: InboxItem[] }) {
  const searchParams = useSearchParams();
  const canal = parseCanalFilter(searchParams.get("canal"));
  const filtrados = canal ? items.filter((item) => item.canales.includes(canal)) : items;

  return (
    <div className="bg-surface-panel border-line-layout flex w-[322px] shrink-0 flex-col border-r">
      <div className="border-line-layout border-b px-3.5 py-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-ink-primary text-[17px] font-[650] tracking-[-0.02em]">Bandeja</h2>
          <MonoMeta>{items.length}</MonoMeta>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span
            aria-hidden
            className="bg-ok animate-pulse-dot h-[5px] w-[5px] shrink-0 rounded-full"
          />
          <span className="text-ink-faint text-[10.5px]">
            Sincronizado en vivo · Meta Cloud API
          </span>
        </div>
      </div>

      <FiltrosCanal />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtrados.length === 0 ? (
          <EmptyState
            title={
              items.length === 0 ? "Esperando primer mensaje" : "Sin conversaciones en este canal"
            }
            description={
              items.length === 0
                ? "Cuando llegue un mensaje vía WhatsApp, Instagram o Facebook, aparecerá acá. Verificá que el webhook Meta esté configurado."
                : "Probá con otro filtro de canal."
            }
            icon={<InboxIcon className="h-10 w-10" />}
          />
        ) : (
          <ul aria-label="Bandeja de conversaciones" className="flex flex-col gap-1 px-2 py-2">
            {filtrados.map((item) => (
              <li key={item.leadId}>
                <InboxListItem item={item} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
