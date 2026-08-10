"use client";

import { useSearchParams } from "next/navigation";
import { FiltrosCanal, parseCanalFilter } from "@/components/inbox/FiltrosCanal";
import { InboxListItem } from "@/components/inbox/InboxListItem";
import { parseOrden, SelectorOrden } from "@/components/inbox/SelectorOrden";
import { AutoAwesome, InboxIcon } from "@/components/icons";
import { EmptyState } from "@/components/shared/EmptyState";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import type { InboxItem } from "@/types/inbox";

/**
 * Encabezado de grupo del modo triage. El contador va al lado del título
 * porque es lo que se escanea: cuántas cosas esperan a una persona.
 */
function EncabezadoGrupo({
  children,
  cuenta,
  marca,
  destacado = false,
}: {
  children: React.ReactNode;
  cuenta: number;
  marca: React.ReactNode;
  destacado?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
      {marca}
      <Eyebrow className={destacado ? "text-brand" : undefined}>{children}</Eyebrow>
      <MonoMeta className={destacado ? "text-brand text-[9px]" : "text-[9px]"}>{cuenta}</MonoMeta>
    </div>
  );
}

/**
 * Panel de lista (322px): encabezado con contador e indicador en vivo,
 * selector de orden, filtros de canal y filas. `items` llega ya cargado del
 * layout (Server Component) y ordenado por triage; el filtro por canal y el
 * modo de orden se aplican acá en cliente sobre ese mismo arreglo porque los
 * layouts de Next no reciben `searchParams` — releer la URL en cliente evita
 * re-fetchear la lista completa por cada click de chip.
 */
export function PanelLista({ items }: { items: InboxItem[] }) {
  const searchParams = useSearchParams();
  const canal = parseCanalFilter(searchParams.get("canal"));
  const orden = parseOrden(searchParams.get("orden"));
  const filtrados = canal ? items.filter((item) => item.canales.includes(canal)) : items;

  const requierenAtencion = filtrados.filter((item) => item.motivo !== null);
  const manejaLaIa = filtrados.filter((item) => item.motivo === null);

  // Recientes es orden cronológico puro: deshace el triage que trajo el server.
  const recientes =
    orden === "recientes"
      ? [...filtrados].sort((a, b) => b.ultimaActividad.getTime() - a.ultimaActividad.getTime())
      : [];

  return (
    <div className="bg-surface-panel border-line-layout flex w-[322px] shrink-0 flex-col border-r">
      <div className="border-line-layout border-b px-3.5 py-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-ink-primary text-[17px] font-[650] tracking-[-0.02em]">Inbox</h2>
          <MonoMeta className="text-[11px]">{items.length}</MonoMeta>
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

      <SelectorOrden />
      <FiltrosCanal />

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
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
        ) : orden === "recientes" ? (
          <ul aria-label="Inbox de conversaciones" className="flex flex-col gap-1 px-2 pt-2">
            {recientes.map((item) => (
              <li key={item.leadId}>
                <InboxListItem item={item} conMotivo={false} />
              </li>
            ))}
          </ul>
        ) : (
          <>
            {requierenAtencion.length > 0 ? (
              <>
                <EncabezadoGrupo
                  cuenta={requierenAtencion.length}
                  destacado
                  marca={
                    <span aria-hidden className="bg-brand h-[5px] w-[5px] shrink-0 rounded-full" />
                  }
                >
                  Requieren tu atención
                </EncabezadoGrupo>
                <ul aria-label="Requieren tu atención" className="flex flex-col gap-1 px-2">
                  {requierenAtencion.map((item) => (
                    <li key={item.leadId}>
                      <InboxListItem item={item} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {manejaLaIa.length > 0 ? (
              <>
                <EncabezadoGrupo
                  cuenta={manejaLaIa.length}
                  marca={<AutoAwesome size={13} className="text-ink-fainter shrink-0" />}
                >
                  La IA está manejando
                </EncabezadoGrupo>
                <ul aria-label="La IA está manejando" className="flex flex-col gap-0.5 px-2">
                  {manejaLaIa.map((item) => (
                    <li key={item.leadId}>
                      <InboxListItem item={item} variante="compacta" />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
