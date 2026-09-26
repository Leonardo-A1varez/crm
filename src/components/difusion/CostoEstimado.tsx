import { totalCosto } from "./mensaje";
import { formatearEntero, formatearUsd } from "./formato";
import { Cifra, Nota } from "./primitivas";
import type { LineaCosto } from "./tipos";

/**
 * Cuánto sale, separando quien tiene la ventana abierta de quien no. Todos
 * reciben la plantilla: con marketing pagan todos; con utility, la ventana
 * abierta sale gratis (`lib/difusion/cobro-meta.ts`).
 *
 * Sin tarifa no hay precio: la línea paga dice "sin tarifa" y el total queda
 * en "—". Un cero ahí se leería como "gratis", y una suma parcial, como el
 * costo entero.
 */
export function CostoEstimado({ lineas }: { lineas: readonly LineaCosto[] }) {
  const total = totalCosto(lineas);

  return (
    <div className="flex flex-col gap-2.5">
      <ul className="flex flex-col gap-2">
        {lineas.map((l) => {
          const gratis = l.usd === 0;
          const color = gratis ? "var(--color-ok)" : undefined;
          return (
            <li key={l.concepto} className="grid grid-cols-[58px_1fr_86px] items-baseline gap-2.5">
              <Cifra
                valor={formatearEntero(l.cantidad)}
                tamano="md"
                color={color}
                className="w-full justify-end"
              />
              <span className="text-ink-dim text-[11.5px]">{l.concepto}</span>
              {l.usd === null ? (
                <span className="text-ink-faint text-right font-mono text-[11px]">sin tarifa</span>
              ) : (
                <Cifra
                  valor={formatearUsd(l.usd)}
                  tamano="md"
                  color={color}
                  className="w-full justify-end"
                />
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-line-row grid grid-cols-[58px_1fr_86px] items-baseline gap-2.5 border-t pt-2.5">
        <span />
        <span className="text-ink-primary text-[11.5px] font-[650]">Total</span>
        {total === null ? (
          <Cifra valor="—" tamano="lg" className="w-full justify-end" />
        ) : (
          <Cifra
            valor={formatearUsd(total)}
            unidad="USD"
            tamano="lg"
            className="w-full justify-end"
          />
        )}
      </div>

      {total === null ? (
        <Nota>
          Sin tarifa no hay precio que mostrar: Meta cobra por mensaje entregado según mercado y
          categoría, y este CRM todavía no tiene esa tabla cargada.
        </Nota>
      ) : null}
      <Nota>
        Todos reciben la plantilla, también quien tiene la ventana de servicio abierta. Meta cobra
        siempre las de marketing; las de utility son gratis dentro de la ventana abierta.
      </Nota>
    </div>
  );
}
