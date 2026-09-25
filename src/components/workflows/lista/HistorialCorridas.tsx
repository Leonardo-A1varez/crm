import Link from "next/link";
import { ArrowForward } from "@/components/icons";
import { EmptyState } from "@/components/shared/EmptyState";
import { tinte } from "@/components/workflows/lista/estado";
import { DESCRIPTOR_FIN } from "@/components/workflows/lista/fin-corrida";
import { formatearEntero } from "@/lib/ui/metricas";
import { cn } from "@/lib/utils";
import type { CorridaEnLista } from "@/components/workflows/lista/tipos";
import type { ReactNode } from "react";

export type FiltroHistorial = "todas" | "fallidas";

/**
 * El historial de corridas de un flujo: la lista a la izquierda, el detalle a
 * la derecha.
 *
 * "Fallidas" es un chip de un click y no una opción adentro de un desplegable.
 * Nadie entra al historial a mirar las que salieron bien; se entra porque algo
 * se rompió. Esconder ese corte detrás de abrir un `<select>`, elegir y esperar
 * a que recargue son tres gestos para la única pregunta que trae a alguien acá.
 */
export function HistorialCorridas({
  nombreFlujo,
  corridas,
  totalCorridas,
  totalFallidas,
  filtro,
  rango,
  hrefFiltro,
  hrefCorrida,
  hrefVolver,
  corridaSeleccionadaId,
  detalle,
}: {
  nombreFlujo: string;
  /** Ya filtradas y ordenadas por el server component. */
  corridas: readonly CorridaEnLista[];
  totalCorridas: number;
  totalFallidas: number;
  filtro: FiltroHistorial;
  /** El rango en texto: "Últimos 30 d". */
  rango: string;
  hrefFiltro: (filtro: FiltroHistorial) => string;
  hrefCorrida: (id: string) => string;
  hrefVolver: string;
  corridaSeleccionadaId?: string;
  /** El panel derecho. Vacío mientras no haya ninguna elegida. */
  detalle?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-line-layout bg-surface-panel flex h-[52px] shrink-0 items-center gap-3 border-b px-4">
        <Link
          href={hrefVolver}
          className="border-line-card text-ink-secondary hover:bg-surface-hover hover:text-ink-primary flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          <ArrowForward size={12} className="rotate-180" aria-hidden />
          Flujos
        </Link>
        <h1 className="text-ink-primary min-w-0 truncate text-[14px] font-[680] tracking-[-0.01em]">
          {nombreFlujo} <span className="text-ink-ghost font-normal">· historial</span>
        </h1>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ChipHistorial
            href={hrefFiltro("todas")}
            activo={filtro === "todas"}
            label="Todas"
            n={totalCorridas}
          />
          <ChipHistorial
            href={hrefFiltro("fallidas")}
            activo={filtro === "fallidas"}
            label="Fallidas"
            n={totalFallidas}
            color="var(--color-danger)"
          />
          <span className="border-line-card text-ink-secondary flex h-[27px] items-center rounded-[8px] border px-2.5 text-[11.5px] font-medium">
            {rango}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Corridas"
          className="border-line-layout bg-surface-root flex w-[520px] shrink-0 flex-col border-r"
        >
          <div className="text-ink-faint grid shrink-0 grid-cols-[58px_1fr_84px_58px_104px] gap-2.5 px-5 py-2.5 font-mono text-[9px] font-semibold tracking-[0.08em] uppercase">
            <span>corrida</span>
            <span>lead</span>
            <span>cuándo</span>
            <span>duró</span>
            <span>terminó</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {corridas.length === 0 ? (
              <EmptyState
                title={filtro === "fallidas" ? "Ninguna corrida falló" : "Todavía no hay corridas"}
                description={
                  filtro === "fallidas"
                    ? `Las ${formatearEntero(totalCorridas)} del período terminaron bien.`
                    : "Cuando el flujo se dispare, cada corrida va a quedar registrada acá."
                }
              />
            ) : (
              <ul className="flex flex-col gap-0.5 px-3 pb-5">
                {corridas.map((c) => (
                  <FilaCorrida
                    key={c.id}
                    corrida={c}
                    href={hrefCorrida(c.id)}
                    seleccionada={c.id === corridaSeleccionadaId}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section
          aria-label="Detalle de la corrida"
          className="bg-surface-panel flex min-w-0 flex-1"
        >
          {detalle ?? (
            <EmptyState
              title="Elegí una corrida"
              description="Se abre con el flujo dibujado, el camino que recorrió y qué pasó en cada paso."
            />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Un chip del encabezado.
 *
 * "Fallidas" se tiñe apenas cuando hay alguna, aunque no esté activo. Un filtro
 * que sólo se distingue después de apretarlo no avisa nada; teñirlo cuando el
 * conteo es mayor que cero convierte el chip en el aviso mismo, y el número que
 * lleva al lado ya dice cuántas son.
 */
function ChipHistorial({
  href,
  activo,
  label,
  n,
  color,
}: {
  href: string;
  activo: boolean;
  label: string;
  n: number;
  color?: string;
}) {
  const tono = color ?? "var(--color-ink-primary)";
  const alerta = color !== undefined && n > 0;

  return (
    <Link
      href={href}
      aria-current={activo ? "true" : undefined}
      className={cn(
        "flex h-[27px] items-center gap-1.5 rounded-[8px] border px-2.5 text-[11.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
        activo || alerta ? "font-semibold" : "border-line-card font-medium",
        !activo && !alerta && "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary",
      )}
      /*
        El activo NO invierte a texto claro sobre el color de relleno. Con
        "Todas" el color es `ink-primary`, casi blanco, y el texto invertido es
        `brand-ink`, también casi blanco: el chip quedaba ilegible. Se ve en el
        navegador y no en el diff, que es de dónde salió.

        Lo que separa activo de "hay fallidas" es el borde y la fuerza del
        tinte, no una inversión: los dos estados quedan con texto de color sobre
        fondo tenue, que llega a contraste en los dos temas.
      */
      style={
        activo
          ? { color: tono, backgroundColor: tinte(tono, 20), borderColor: tinte(tono, 45) }
          : alerta
            ? { color: tono, backgroundColor: tinte(tono, 10), borderColor: "transparent" }
            : undefined
      }
    >
      {label}
      <span className="font-mono text-[10.5px] tabular-nums opacity-70">{formatearEntero(n)}</span>
    </Link>
  );
}

function FilaCorrida({
  corrida,
  href,
  seleccionada,
}: {
  corrida: CorridaEnLista;
  href: string;
  seleccionada: boolean;
}) {
  const fin = DESCRIPTOR_FIN[corrida.fin];
  const Glifo = fin.glifo;

  return (
    <li>
      <Link
        href={href}
        aria-current={seleccionada ? "true" : undefined}
        className={cn(
          "grid grid-cols-[58px_1fr_84px_58px_104px] items-center gap-2.5 rounded-[9px] px-2 py-2.5 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-brand)]",
          seleccionada
            ? "bg-surface-card border-line-control border"
            : "hover:bg-surface-hover border border-transparent",
        )}
      >
        <span className="text-ink-secondary truncate font-mono text-[11.5px] font-medium">
          {corrida.codigo}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-ink-primary truncate text-[11.5px] font-[650]">
            {corrida.leadNombre}
          </span>
          {corrida.leadVehiculo ? (
            <span className="text-ink-ghost truncate font-mono text-[10.5px]">
              {corrida.leadVehiculo}
            </span>
          ) : null}
        </span>
        <span className="text-ink-faint truncate text-[11px]">{corrida.cuando}</span>
        <span className="text-ink-secondary font-mono text-[11px] tabular-nums">
          {corrida.duracion}
        </span>
        <span
          className="inline-flex w-fit items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-[10.5px] leading-none font-semibold"
          style={{ color: fin.color, backgroundColor: tinte(fin.color, 12) }}
        >
          <Glifo size={10} strokeWidth={2} aria-hidden />
          {fin.label}
        </span>
      </Link>
    </li>
  );
}
