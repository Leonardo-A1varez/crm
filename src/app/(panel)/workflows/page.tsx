import { SearchField } from "@/components/shared/SearchField";
import { ListadoFlujos } from "@/components/workflows/lista/ListadoFlujos";
import {
  ORDENAR_WORKFLOWS_LABEL,
  PARAM,
  filtrarYOrdenarWorkflows,
  parseFiltrosWorkflowsParams,
} from "@/lib/ui/filtros-workflows";
import { getCurrentRol } from "@/server/auth/guards";
import { getWorkflowsAdminServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import { searchLeadsAction } from "../leads/_actions/search-leads.action";
import { dispararWorkflowManualAction } from "./_actions/disparo-manual.actions";
import { importarFlujoAction } from "./_actions/importar.actions";
import { contarCorridasVivasAction } from "./_actions/listado.actions";
import {
  deleteWorkflowAction,
  duplicateWorkflowAction,
  pauseWorkflowAction,
  resumeWorkflowAction,
} from "./_actions/workflows.actions";
import { DispararAhora } from "./_components/DispararAhora";
import { ImportarFlujo } from "./_components/ImportarFlujo";
import { MenuFlujo } from "./_components/MenuFlujo";
import { OrdenFlujos } from "./_components/OrdenFlujos";
import {
  aFlujoEnLista,
  conteosPorEstado,
  flujosQueNecesitanConteoVivo,
  totalCorridas30d,
} from "./_lib/listado";
import type { FiltroEstado } from "@/components/workflows/lista/tipos";
import type { FiltrosWorkflowsValores } from "@/lib/ui/filtros-workflows";
import type { ValorParam } from "@/lib/ui/filtros-leads";

export const dynamic = "force-dynamic";

/**
 * `/workflows`.
 *
 * El filtro de estado son chips con conteo y no un `<select>`: el número por
 * estado —"2 con errores"— es justo el dato que hace falta ver sin abrir nada.
 * Por eso la pantalla necesita la lista **sin filtrar** además de la filtrada,
 * y por eso llama al servicio directamente en vez de a `getWorkflowsAction`,
 * que sólo devuelve la filtrada.
 */
export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, ValorParam>>;
}) {
  const params = await searchParams;
  const filtros = parseFiltrosWorkflowsParams(params);
  const filtro: FiltroEstado = filtros.estado ?? "todos";
  const ordenar = filtros.ordenar ?? "editado";

  const [rol, lectura] = await Promise.all([getCurrentRol(), leerFlujos()]);
  const esAdmin = rol === "admin";

  if (!lectura.ok) {
    return (
      <div className="bg-surface-root flex h-full flex-col overflow-hidden">
        <p className="text-danger p-5 text-[12px]">{lectura.error}</p>
      </div>
    );
  }

  const { todos, ahora } = lectura;
  const visibles = filtrarYOrdenarWorkflows(todos, filtros);

  // Sólo los pausados necesitan el conteo de corridas vivas; el resto va en 0 y
  // la tarjeta no lo lee. Si la consulta falla, el mapa queda vacío: la nota de
  // pausa muestra la frase sin número en vez de tumbar la pantalla entera.
  const vivas = await contarCorridasVivasAction({
    workflowIds: flujosQueNecesitanConteoVivo(visibles),
  });
  const porFlujo = vivas.ok ? vivas.porFlujo : {};

  const flujos = visibles.map((r) => aFlujoEnLista(r, ahora, porFlujo[r.workflow.id] ?? 0));

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <ListadoFlujos
        flujos={flujos}
        conteos={conteosPorEstado(todos)}
        filtro={filtro}
        hrefFiltro={(e) => hrefListado(filtros, e)}
        hrefNuevo="/workflows/nuevo"
        totalCorridas30d={totalCorridas30d(todos)}
        orden={ORDENAR_WORKFLOWS_LABEL[ordenar].toLowerCase()}
        acciones={
          <>
            <SearchField
              action="/workflows"
              defaultValue={filtros.busqueda}
              placeholder="Buscar flujo…"
              label="Buscar flujo"
              className="w-[230px]"
              conservar={paramsAConservar(filtros)}
            />
            <OrdenFlujos ordenar={ordenar} />
            {/* Mismo gate que la action: un vendedor no crea flujos. */}
            {esAdmin ? <ImportarFlujo onImportar={importarFlujoAction} /> : null}
          </>
        }
        // Un vendedor ve la lista y entra a los flujos, pero no los pausa ni los
        // borra: mismo gate que `soloAdmin()` en las actions y que la policy de
        // RLS. Sin el menú no hay botón que falle con un error de permisos.
        renderAcciones={
          esAdmin
            ? (flujo) => (
                <>
                  {/* Sólo si lo que corre —la versión publicada— arranca a mano:
                      la action rechaza cualquier otro disparador. */}
                  {flujo.disparaAMano ? (
                    <DispararAhora
                      workflowId={flujo.id}
                      nombreFlujo={flujo.nombre}
                      onBuscarLeads={searchLeadsAction}
                      onDisparar={dispararWorkflowManualAction}
                    />
                  ) : null}
                  <MenuFlujo
                    workflowId={flujo.id}
                    estado={flujo.estado}
                    onDuplicar={duplicateWorkflowAction}
                    onPausar={pauseWorkflowAction}
                    onReanudar={resumeWorkflowAction}
                    onEliminar={deleteWorkflowAction}
                  />
                </>
              )
            : undefined
        }
      />
    </div>
  );
}

/**
 * La lectura de la pantalla, incluido el reloj.
 *
 * El `Date.now()` va acá y no en el cuerpo del componente porque el "ahora" es
 * parte de los datos —de él salen los "hace 3 m" de cada tarjeta—, no de la
 * pintura. `react-hooks/purity` lo prohíbe en el render y tiene razón: aunque
 * este componente corra una sola vez por request en el servidor, la regla no
 * puede saberlo, y la forma correcta de callarla es también la más honesta.
 */
async function leerFlujos() {
  try {
    const svc = await getWorkflowsAdminServiceForRequest();
    const todos = await svc.listarConResumen();
    return { ok: true as const, todos, ahora: Date.now() };
  } catch {
    return { ok: false as const, error: "No se pudieron cargar los flujos." };
  }
}

/**
 * Los params que el GET del buscador tiene que arrastrar. Un formulario GET
 * manda sólo sus propios campos, así que sin esto buscar apagaría el chip de
 * estado y el orden que la pantalla tenga puestos.
 */
function paramsAConservar(filtros: FiltrosWorkflowsValores): Record<string, string> {
  const conservar: Record<string, string> = {};
  if (filtros.estado && filtros.estado !== "todos") conservar[PARAM.estado] = filtros.estado;
  if (filtros.ordenar && filtros.ordenar !== "editado") conservar[PARAM.ordenar] = filtros.ordenar;
  return conservar;
}

/** Link de un chip de estado, conservando búsqueda y orden. */
function hrefListado(filtros: FiltrosWorkflowsValores, estado: FiltroEstado): string {
  const p = new URLSearchParams();
  if (filtros.busqueda) p.set(PARAM.busqueda, filtros.busqueda);
  if (estado !== "todos") p.set(PARAM.estado, estado);
  if (filtros.ordenar && filtros.ordenar !== "editado") p.set(PARAM.ordenar, filtros.ordenar);
  const query = p.toString();
  return query ? `/workflows?${query}` : "/workflows";
}
