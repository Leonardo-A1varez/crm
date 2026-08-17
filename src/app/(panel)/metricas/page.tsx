import { borrarCampaniaAction } from "@/app/(panel)/metricas/_actions/borrar-campania.action";
import { crearCampaniaAction } from "@/app/(panel)/metricas/_actions/crear-campania.action";
import { editarCampaniaAction } from "@/app/(panel)/metricas/_actions/editar-campania.action";
import { PanelMetricas } from "@/components/metricas/PanelMetricas";
import { PestanasMetricas } from "@/components/metricas/PestanasMetricas";
import { SelectorRango } from "@/components/metricas/SelectorRango";
import { PageHeader } from "@/components/shared/PageHeader";
import { getCampaniasAdminServiceForRequest } from "@/server/bootstrap/campanias-bootstrap";
import { getMetricsServiceForRequest } from "@/server/bootstrap/metricas-bootstrap";
import { TABS_METRICAS } from "@/types/metricas";
import type { TabMetricas } from "@/types/metricas";

export const dynamic = "force-dynamic";

const TAB_POR_DEFECTO: TabMetricas = "total";
const DIA_MS = 24 * 60 * 60 * 1000;

function leerTab(valor: string | string[] | undefined): TabMetricas {
  return typeof valor === "string" && (TABS_METRICAS as readonly string[]).includes(valor)
    ? (valor as TabMetricas)
    : TAB_POR_DEFECTO;
}

/**
 * `esCalendario` distingue "el param vino y se parseó" de "se usó el
 * default": el default (`hastaPorDefecto = new Date()`) ya es un instante
 * exacto y NO necesita `finDeDiaExclusivo`; un `?hasta=xyz` malformado tiene
 * que caer en el mismo caso — sin la señal, ambos se ven idénticos a
 * `typeof valor === "string"` y un param roto termina recibiendo el +1 día
 * que no le corresponde.
 */
function leerFecha(
  valor: string | string[] | undefined,
  porDefecto: Date,
): { fecha: Date; esCalendario: boolean } {
  if (typeof valor !== "string") return { fecha: porDefecto, esCalendario: false };
  const parsed = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? { fecha: porDefecto, esCalendario: false }
    : { fecha: parsed, esCalendario: true };
}

/**
 * `MetricsService.obtener` trata `hasta` como cota EXCLUSIVA — los repos aplican
 * `[desde, hasta)` de verdad, no solo lo documentan. Un `<input type="date">` o
 * el `hasta` guardado de una campaña entregan un DÍA de calendario
 * ("2026-08-17"), que como `Date` cae en la medianoche de ESE día: el instante
 * en que el día ARRANCA, no en el que termina. Pasarlo tal cual a `obtener()`
 * excluiría el día completo que la persona eligió. Empujar al inicio del día
 * siguiente hace que "Hasta: 17/08" incluya el 17 entero.
 */
function finDeDiaExclusivo(fechaCalendario: Date): Date {
  return new Date(fechaCalendario.getTime() + DIA_MS);
}

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<{
    desde?: string | string[];
    hasta?: string | string[];
    tab?: string | string[];
    campania?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const tab = leerTab(params.tab);
  const hastaPorDefecto = new Date();
  const desdePorDefecto = new Date(hastaPorDefecto.getTime() - 30 * DIA_MS);
  const desdeLeida = leerFecha(params.desde, desdePorDefecto);
  const hastaLeida = leerFecha(params.hasta, hastaPorDefecto);
  const campaniaId = typeof params.campania === "string" ? params.campania : null;

  const [svc, campaniasSvc] = await Promise.all([
    getMetricsServiceForRequest(),
    getCampaniasAdminServiceForRequest(),
  ]);
  const campanias = await campaniasSvc.listar();
  const campaniaSeleccionada = campaniaId
    ? (campanias.find((c) => c.id === campaniaId) ?? null)
    : null;

  // Una campaña elegida manda sobre lo que haya en la URL para desde Y hasta
  // (no solo hasta): si sus fechas se editaron después de armar el link, la
  // consulta usa las vigentes, no las que quedaron pisadas en el querystring.
  const desdeEfectiva = campaniaSeleccionada?.desde ?? desdeLeida.fecha;
  const hastaCalendario = campaniaSeleccionada?.hasta ?? hastaLeida.fecha;

  // Cota exclusiva real para `obtener()`, aplicada UNA sola vez sin importar
  // si `hastaCalendario` vino de un atajo, del input de rango libre o de una
  // campaña: los tres viajan como el mismo día de calendario y no hay forma
  // (ni falta hacerla) de distinguirlos acá. Solo se salta cuando no hubo
  // día de calendario real que corregir — el default sin querystring, que ya
  // es el instante actual.
  const esDiaCalendario = campaniaSeleccionada !== null || hastaLeida.esCalendario;
  const hastaExclusiva = esDiaCalendario ? finDeDiaExclusivo(hastaCalendario) : hastaPorDefecto;

  const m = await svc.obtener(desdeEfectiva, hastaExclusiva);

  const desdeStr = desdeEfectiva.toISOString().slice(0, 10);
  const hastaStr = hastaCalendario.toISOString().slice(0, 10);

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Métricas"
        subtitle={`últimos ${m.dias} días`}
        actions={
          <SelectorRango
            tab={tab}
            desde={desdeStr}
            hasta={hastaStr}
            campaniaId={campaniaId}
            campanias={campanias}
            onCrearCampania={crearCampaniaAction}
            onEditarCampania={editarCampaniaAction}
            onBorrarCampania={borrarCampaniaAction}
          />
        }
      />
      <PestanasMetricas activa={tab} desde={desdeStr} hasta={hastaStr} campania={campaniaId} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelMetricas m={m} tab={tab} />
      </div>
    </div>
  );
}
