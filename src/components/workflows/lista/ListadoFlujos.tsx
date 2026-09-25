import Link from "next/link";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { BadgeEstado, LeyendaEstados } from "@/components/workflows/lista/BadgeEstado";
import { DESCRIPTOR_ESTADO, ESTADOS_FLUJO, tinte } from "@/components/workflows/lista/estado";
import { TarjetaFlujo } from "@/components/workflows/lista/TarjetaFlujo";
import { cantidad, formatearEntero } from "@/lib/ui/metricas";
import type { EstadoFlujo } from "@/components/workflows/lista/estado";
import type { FiltroEstado, FlujoEnLista } from "@/components/workflows/lista/tipos";
import type { ReactNode } from "react";

/**
 * `/workflows`. Recibe la lista YA filtrada y ordenada —el corte lo hace el
 * server component, igual que en la lista vieja— y sólo dibuja.
 *
 * Los filtros son links y no botones con estado: el filtro vive en la URL,
 * sobrevive a un refresh y se comparte. Es la misma decisión que ya tomó
 * `FiltrosWorkflows`; lo que cambia es la forma. Un `<select>` esconde los
 * conteos detrás de un click, y el conteo es justo el dato que importa: querés
 * ver que hay 2 con errores SIN tener que abrir nada.
 */
export function ListadoFlujos({
  flujos,
  conteos,
  filtro,
  hrefFiltro,
  hrefNuevo,
  totalCorridas30d,
  orden,
  acciones,
  renderAcciones,
}: {
  flujos: readonly FlujoEnLista[];
  /** Conteo por estado sobre el total sin filtrar. Alimenta los chips. */
  conteos: Readonly<Record<FiltroEstado, number>>;
  filtro: FiltroEstado;
  /** El caller decide cómo se llama el parámetro; esta carpeta no lo asume. */
  hrefFiltro: (filtro: FiltroEstado) => string;
  /** Crear un flujo abre la galería de plantillas, nunca un lienzo vacío. */
  hrefNuevo: string;
  totalCorridas30d: number;
  /** Cómo está ordenada la lista, dicho en texto: "actividad ↓". */
  orden: string;
  /** Acciones extra del encabezado (importar, por ejemplo). */
  acciones?: ReactNode;
  /**
   * Controles por flujo -- pausar, duplicar, eliminar. Es un render-prop y no
   * una lista de callbacks porque esas tres son Server Actions y
   * `components/**` no puede importar `app/**` (boundaries de ESLint): quien
   * las tiene es la pantalla. Sin esto, adoptar esta lista costaba perder el
   * menu que la lista vieja si tenia.
   */
  renderAcciones?: (flujo: FlujoEnLista) => ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Flujos"
        subtitle={
          <>
            {/*
              "corrida" estaba escrito fijo en plural: con un solo flujo
              disparado la pantalla decía "1 corridas". No se resuelve con
              `cantidad()` como el conteo de flujos porque acá la cifra va en
              mono y el sustantivo no, así que el número y la palabra son dos
              nodos y la concordancia queda a la vista.
            */}
            {cantidad(conteos.todos, "flujo")} ·{" "}
            <span className="font-mono tabular-nums">{formatearEntero(totalCorridas30d)}</span>{" "}
            {totalCorridas30d === 1 ? "corrida" : "corridas"} en los últimos 30 días
          </>
        }
        actions={
          <>
            {acciones}
            <Link
              href={hrefNuevo}
              className="bg-brand text-brand-ink hover:bg-brand-deep flex h-8 shrink-0 items-center rounded-[9px] px-3.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
            >
              Nuevo flujo
            </Link>
          </>
        }
      />

      <div className="border-line-layout bg-surface-panel flex shrink-0 flex-wrap items-center gap-1.5 border-b px-5 py-2.5">
        <ChipFiltro
          estado="todos"
          activo={filtro === "todos"}
          n={conteos.todos}
          href={hrefFiltro}
        />
        {ESTADOS_FLUJO.map((estado) => (
          <ChipFiltro
            key={estado}
            estado={estado}
            activo={filtro === estado}
            n={conteos[estado]}
            href={hrefFiltro}
          />
        ))}
        <span className="text-ink-ghost ml-auto font-mono text-[11px]">orden: {orden}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {flujos.length === 0 ? (
          <Vacio filtro={filtro} hayAlguno={conteos.todos > 0} />
        ) : (
          <div className="flex flex-col gap-3.5 p-5">
            <ul className="grid grid-cols-2 gap-3">
              {flujos.map((f) => (
                <TarjetaFlujo key={f.id} flujo={f} acciones={renderAcciones?.(f)} />
              ))}
            </ul>
            <LeyendaEstados className="max-w-[560px]" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Un chip de filtro. El conteo va en mono aunque sea un número corto: es un dato
 * que se compara entre chips —2 con errores contra 14 activos— y comparar es
 * exactamente lo que la mono resuelve, porque las cifras ocupan lo mismo y las
 * columnas se alinean solas.
 */
function ChipFiltro({
  estado,
  activo,
  n,
  href,
}: {
  estado: FiltroEstado;
  activo: boolean;
  n: number;
  href: (filtro: FiltroEstado) => string;
}) {
  const label = estado === "todos" ? "Todos" : DESCRIPTOR_ESTADO[estado].label;
  const color = estado === "todos" ? "var(--color-ink-primary)" : DESCRIPTOR_ESTADO[estado].color;
  const Glifo = estado === "todos" ? null : DESCRIPTOR_ESTADO[estado].glifo;

  return (
    <Link
      href={href(estado)}
      aria-current={activo ? "true" : undefined}
      className={
        activo
          ? "flex h-[27px] items-center gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          : "border-line-card text-ink-secondary hover:bg-surface-hover hover:text-ink-primary flex h-[27px] items-center gap-1.5 rounded-[8px] border px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
      }
      style={activo ? { color, backgroundColor: tinte(color, 14) } : undefined}
    >
      {Glifo ? <Glifo size={11} strokeWidth={2} aria-hidden /> : null}
      {label}
      <span className="font-mono text-[10.5px] tabular-nums opacity-60">{formatearEntero(n)}</span>
    </Link>
  );
}

function Vacio({ filtro, hayAlguno }: { filtro: FiltroEstado; hayAlguno: boolean }) {
  if (!hayAlguno) {
    return (
      <EmptyState
        title="Todavía no hay flujos"
        description="Un flujo automatiza lo que hoy hace alguien a mano: seguir una cotización, etiquetar, escalar a una persona."
      />
    );
  }

  const estado = filtro as EstadoFlujo;

  return (
    <EmptyState
      title={`Ningún flujo está ${DESCRIPTOR_ESTADO[estado].label.toLowerCase()}`}
      description={DESCRIPTOR_ESTADO[estado].significado}
      action={
        <span className="inline-flex items-center gap-2">
          <BadgeEstado estado={estado} />
        </span>
      }
    />
  );
}
