import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowForward } from "@/components/icons";
import { DetalleCorrida } from "@/components/workflows/lista/DetalleCorrida";
import { HistorialCorridas } from "@/components/workflows/lista/HistorialCorridas";
import { getWorkflowsAdminServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import {
  obtenerDetalleRunAction,
  obtenerHistorialWorkflowAction,
} from "../../_actions/workflows.actions";
import { aCorridaEnLista, aDetalleDeCorrida } from "../../_lib/historial";
import type { FiltroHistorial } from "@/components/workflows/lista/HistorialCorridas";
import type { WorkflowVersion } from "@/types/entities";

export const dynamic = "force-dynamic";

/** Cuántas corridas trae una página de `listarHistorial`. Es el `PAGE_SIZE` del repo. */
const POR_PAGINA = 20;

function esFiltro(v: string | undefined): v is FiltroHistorial {
  return v === "todas" || v === "fallidas";
}

/**
 * `/workflows/[id]/historial` — las corridas de un flujo, con el detalle al lado.
 *
 * Es la ruta a la que apunta el botón "Historial" de cada tarjeta, que hasta
 * ahora era un link a una pantalla que no existía.
 *
 * Se piden **dos** historiales y no uno: el filtro elegido decide cuál se
 * lista, pero los dos chips del encabezado tienen que mostrar su conteo real al
 * mismo tiempo —"Todas 147 · Fallidas 3"—, y `listarHistorial` filtra por un
 * estado por vez. Contar las fallidas sobre la página que se está mostrando
 * daría 3 de las últimas 20, no 3 de 147.
 */
export default async function HistorialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filtro?: string | string[]; corrida?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;

  const pedido = typeof query.filtro === "string" ? query.filtro : undefined;
  const filtro: FiltroHistorial = esFiltro(pedido) ? pedido : "todas";
  const corridaId = typeof query.corrida === "string" ? query.corrida : undefined;

  const svc = await getWorkflowsAdminServiceForRequest();
  const workflow = await svc.detalle(id);
  if (!workflow) notFound();

  const lectura = await leerHistorial(id);
  if (!lectura.ok) {
    return (
      <div className="bg-surface-root flex h-full flex-col overflow-hidden">
        <p className="text-danger p-5 text-[12px]">{lectura.error}</p>
      </div>
    );
  }

  const { todas, fallidas, ahora } = lectura;
  const pagina = filtro === "fallidas" ? fallidas : todas;
  const corridas = pagina.runs.map((r) => aCorridaEnLista(r, ahora));

  const detalle = corridaId ? await leerDetalle(corridaId, workflow.versiones, ahora) : null;

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <HistorialCorridas
        nombreFlujo={workflow.workflow.nombre}
        corridas={corridas}
        totalCorridas={todas.total}
        totalFallidas={fallidas.total}
        filtro={filtro}
        // No se aplica ningún filtro de fecha: la consulta trae la primera
        // página del historial completo, y el repo no tiene "cargar más". Decir
        // "Últimos 30 d" describiría un recorte que nadie hizo; decir cuántas
        // se están viendo es lo único cierto que se puede poner acá.
        rango={pagina.total > POR_PAGINA ? `Últimas ${POR_PAGINA}` : "Todo el historial"}
        hrefFiltro={(f) => href(id, f, corridaId)}
        hrefCorrida={(runId) => href(id, filtro, runId)}
        hrefVolver="/workflows"
        corridaSeleccionadaId={corridaId}
        detalle={
          detalle ? (
            <DetalleCorrida
              detalle={detalle}
              // Cuando el fallo es una plantilla que Meta pausó, lo que hay que
              // mirar es la salud del número, y eso vive en Ajustes.
              hrefSalud="/ajustes?tab=salud"
              // Reanudar y ejecutar de nuevo viven en la corrida abierta sobre
              // el lienzo, que es donde se ve qué se reusa antes de apretar.
              acciones={
                corridaId ? (
                  <Link
                    href={`/workflows/${id}/corridas/${corridaId}`}
                    className="border-line-card bg-surface-card text-ink-primary hover:bg-surface-hover flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                  >
                    Abrir en el lienzo
                    <ArrowForward size={12} aria-hidden />
                  </Link>
                ) : undefined
              }
            />
          ) : undefined
        }
      />
    </div>
  );
}

/**
 * Las dos páginas del historial y el reloj, en una sola lectura.
 *
 * El `Date.now()` viaja con los datos y no se lee en el render: los "hace 3 m"
 * de cada fila salen de él, así que es parte de la lectura. `react-hooks/purity`
 * lo prohíbe en el cuerpo del componente y hace bien.
 */
async function leerHistorial(workflowId: string) {
  const [todas, fallidas] = await Promise.all([
    obtenerHistorialWorkflowAction({ workflowId, filtros: { estado: "todos" } }),
    obtenerHistorialWorkflowAction({ workflowId, filtros: { estado: "fallado" } }),
  ]);

  if (!todas.ok) return { ok: false as const, error: todas.error };
  if (!fallidas.ok) return { ok: false as const, error: fallidas.error };

  return { ok: true as const, todas: todas.data, fallidas: fallidas.data, ahora: Date.now() };
}

async function leerDetalle(runId: string, versiones: readonly WorkflowVersion[], ahora: number) {
  const r = await obtenerDetalleRunAction({ runId });
  if (!r.ok || r.data === null) return null;
  // A una const local: dentro del closure de `find`, TypeScript pierde el
  // estrechamiento que hizo el `if` sobre `r.data`.
  const run = r.data;
  // El grafo tiene que ser el de la versión con la que ESTA corrida arrancó:
  // una corrida vieja queda pinneada a su versión, no a la publicada hoy. Sin
  // él, la línea de tiempo mostraría los ids crudos de los nodos.
  const version = versiones.find((v) => v.version === run.version_numero);
  return aDetalleDeCorrida(run, version?.grafo, ahora);
}

function href(workflowId: string, filtro: FiltroHistorial, corridaId?: string): string {
  const p = new URLSearchParams();
  if (filtro !== "todas") p.set("filtro", filtro);
  if (corridaId) p.set("corrida", corridaId);
  const query = p.toString();
  return query
    ? `/workflows/${workflowId}/historial?${query}`
    : `/workflows/${workflowId}/historial`;
}
