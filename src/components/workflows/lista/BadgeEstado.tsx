import { DESCRIPTOR_ESTADO, tinte } from "@/components/workflows/lista/estado";
import { cn } from "@/lib/utils";
import type { EstadoFlujo } from "@/components/workflows/lista/estado";

/**
 * El badge de estado de un flujo. Glifo + palabra + color, en ese orden de
 * importancia: ver `DescriptorEstado.glifo` en `estado.ts` para por qué el
 * color va tercero y no primero (dos pares de la paleta no se distinguen y está
 * medido, no supuesto).
 *
 * El glifo es `aria-hidden`: repite lo que el texto de al lado ya dice, y un
 * lector de pantalla que anuncie "icono, Con errores" sólo agrega ruido. La
 * redundancia es para el ojo, no para el oído.
 */
export function BadgeEstado({ estado, className }: { estado: EstadoFlujo; className?: string }) {
  const { label, glifo: Glifo, color } = DESCRIPTOR_ESTADO[estado];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-[7px] px-2 py-1 text-[10.5px] leading-none font-semibold",
        className,
      )}
      style={{ color, backgroundColor: tinte(color, 12) }}
    >
      <Glifo size={11} strokeWidth={2} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Las cinco definiciones, juntas y en el mismo lugar.
 *
 * Un badge suelto sólo se entiende si ya sabés el vocabulario; "Con cambios" y
 * "Borrador" son indistinguibles para alguien que entra por primera vez. En vez
 * de repetir la definición en cada tarjeta —seis tarjetas, seis veces lo mismo—
 * se dice una vez, acá, en un bloque que se abre y se cierra.
 */
export function LeyendaEstados({ className }: { className?: string }) {
  return (
    <details className={cn("group", className)}>
      <summary className="text-ink-faint hover:text-ink-secondary inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[7px] px-1.5 py-1 text-[11px] transition-colors marker:content-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]">
        <span
          aria-hidden
          className="text-ink-ghost inline-block transition-transform group-open:rotate-90"
        >
          &rsaquo;
        </span>
        Qué significa cada estado
      </summary>
      <ul className="border-line-card bg-surface-card mt-2 flex flex-col gap-2 rounded-[11px] border p-3">
        {(Object.keys(DESCRIPTOR_ESTADO) as EstadoFlujo[]).map((estado) => (
          <li key={estado} className="flex items-start gap-2.5">
            <BadgeEstado estado={estado} className="w-[104px] justify-start" />
            <span className="text-ink-faint pt-0.5 text-[11px] leading-relaxed">
              {DESCRIPTOR_ESTADO[estado].significado}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
