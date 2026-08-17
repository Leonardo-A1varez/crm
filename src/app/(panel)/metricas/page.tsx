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
 * Todas las fuentes de fecha de esta pantalla son DÍAS DE CALENDARIO, incluido
 * el default: el `<input type="date">`, el atajo de N días, el `hasta` de una
 * campaña y la ventana por defecto entregan todos "2026-08-17". Por eso no hace
 * falta distinguir "vino del querystring" de "se usó el default": un `?hasta=xyz`
 * malformado cae en el default, que es un día de calendario igual que el param
 * bien formado, y recibe el mismo `finDeDiaExclusivo`.
 */
function leerFecha(valor: string | string[] | undefined, porDefecto: Date): Date {
  if (typeof valor !== "string") return porDefecto;
  const parsed = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? porDefecto : parsed;
}

/**
 * Hoy como día de calendario UTC (medianoche), que es la misma unidad con la
 * que `rangoDeAtajo` arma los atajos de 7/30/90 en `SelectorRango`. Antes el
 * default era `new Date()` —un instante— y por eso el `desde` calculado no
 * coincidía nunca con el que produce `rangoDeAtajo(30)`: al entrar sin params
 * el header decía "últimos 30 días" y ninguna píldora quedaba activa.
 */
function hoyCalendario(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
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
  // Mismo modelo que `rangoDeAtajo(30)`: N días de calendario con hoy incluido,
  // o sea hoy − 29. Sin esto el default no coincide con ningún atajo.
  const hoy = hoyCalendario();
  const desdePorDefecto = new Date(hoy.getTime() - 29 * DIA_MS);
  const desdeLeida = leerFecha(params.desde, desdePorDefecto);
  const hastaLeida = leerFecha(params.hasta, hoy);
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
  const desdePedida = campaniaSeleccionada?.desde ?? desdeLeida;
  const hastaPedida = campaniaSeleccionada?.hasta ?? hastaLeida;

  // Cota exclusiva real para `obtener()`, aplicada UNA sola vez sin importar si
  // `hasta` vino de un atajo, del input de rango libre, de una campaña o del
  // default: los cuatro viajan como el mismo día de calendario.
  //
  // Con `desde` posterior a `hasta` la ventana es negativa: todos los repos
  // devuelven `[]` y el header dice "últimos -N días" sin que nada avise. Es
  // alcanzable en dos clicks (el `min`/`max` de los inputs lo evita en el
  // navegador, no en un link pegado a mano), así que acá se cae a la ventana
  // por defecto en vez de renderizar un tablero en cero que parece un dato.
  const rangoInvalido = desdePedida.getTime() >= finDeDiaExclusivo(hastaPedida).getTime();
  const desdeEfectiva = rangoInvalido ? desdePorDefecto : desdePedida;
  const hastaCalendario = rangoInvalido ? hoy : hastaPedida;
  const hastaExclusiva = finDeDiaExclusivo(hastaCalendario);

  const m = await svc.obtener(desdeEfectiva, hastaExclusiva);

  const desdeStr = desdeEfectiva.toISOString().slice(0, 10);
  const hastaStr = hastaCalendario.toISOString().slice(0, 10);
  const hoyStr = hoy.toISOString().slice(0, 10);

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
            hoy={hoyStr}
            campaniaId={campaniaId}
            campanias={campanias}
            onCrearCampania={crearCampaniaAction}
            onEditarCampania={editarCampaniaAction}
            onBorrarCampania={borrarCampaniaAction}
          />
        }
      />
      {/* La campaña no atribuye nada: `leads.campania_id` es nullable y no hay
          un solo escritor. El filtro recorta por fecha y punto, así que el
          número que se ve NO es "lo que trajo esa campaña". Va acá y no dentro
          del modal de gestión porque el que lee el tablero no abrió el modal. */}
      {campaniaSeleccionada !== null ? (
        <p className="border-line-layout bg-surface-panel text-ink-faint shrink-0 border-b px-5 py-2 text-[11.5px]">
          Campaña «{campaniaSeleccionada.nombre}» · filtrado por fecha, sin atribución real de
          origen
        </p>
      ) : null}
      <PestanasMetricas activa={tab} desde={desdeStr} hasta={hastaStr} campania={campaniaId} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelMetricas m={m} tab={tab} />
      </div>
    </div>
  );
}
