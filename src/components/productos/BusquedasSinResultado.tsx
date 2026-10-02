import { Inventory2 } from "@/components/icons";
import { EmptyState } from "@/components/shared/EmptyState";
import type { BusquedaSinResultado } from "@/types/productos";

const TH =
  "text-ink-faint bg-surface-panel sticky top-0 z-10 px-3.5 py-2.5 text-left font-mono text-[9px] font-semibold tracking-[0.13em] uppercase shadow-[inset_0_-1px_0_var(--color-line-layout)]";
const TD =
  "h-[38px] overflow-hidden px-3.5 text-[12.5px] text-ellipsis whitespace-nowrap shadow-[inset_0_-1px_0_var(--color-line-layout)]";

const fechaFmt = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short" });

function vehiculo(f: BusquedaSinResultado): string | null {
  const partes = [f.marca, f.modelo, f.anio !== null ? String(f.anio) : null].filter(
    (p): p is string => p !== null,
  );
  return partes.length > 0 ? partes.join(" ") : null;
}

/**
 * Lo que los clientes pidieron y el catálogo no tuvo, agrupado, para saber qué
 * siglas o productos faltan. Server component: recibe las filas ya leídas.
 */
export function BusquedasSinResultado({
  filas,
  dias,
}: {
  filas: BusquedaSinResultado[];
  dias: number;
}) {
  if (filas.length === 0) {
    return (
      <EmptyState
        icon={<Inventory2 />}
        title="Sin búsquedas sin resultado"
        description={`En los últimos ${dias} días el catálogo encontró todo lo que el agente buscó.`}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-ink-faint shrink-0 px-5 py-2.5 text-[11.5px]">
        Búsquedas del agente sin ningún producto, de los últimos {dias} días (el historial se borra
        junto con las conversaciones). Las más repetidas primero.
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th scope="col" className={TH}>
                Búsqueda
              </th>
              <th scope="col" className={TH}>
                Vehículo
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Veces
              </th>
              <th scope="col" className={TH}>
                Última vez
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const v = vehiculo(f);
              return (
                <tr
                  key={`${f.busqueda}|${f.marca}|${f.modelo}|${f.anio}`}
                  className="hover:bg-surface-elevated"
                >
                  <td
                    className={`${TD} text-ink-primary max-w-[360px] font-medium`}
                    title={f.busqueda}
                  >
                    {f.busqueda}
                  </td>
                  <td className={`${TD} text-ink-secondary`}>
                    {v ?? <span className="text-ink-ghost">—</span>}
                  </td>
                  <td className={`${TD} text-ink-primary text-right font-mono tabular-nums`}>
                    {f.veces}
                  </td>
                  <td className={`${TD} text-ink-dim font-mono text-[11.5px] tabular-nums`}>
                    {fechaFmt.format(f.ultima_vez)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
