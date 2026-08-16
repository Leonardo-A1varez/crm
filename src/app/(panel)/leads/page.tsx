import { DuplicadosBanner } from "@/components/leads/DuplicadosBanner";
import { EtiquetasDialog } from "@/components/leads/EtiquetasDialog";
import { FiltrosLeads } from "@/components/leads/FiltrosLeads";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchField } from "@/components/shared/SearchField";
import { contarFiltrosActivos, PARAM, parseFiltrosLeads } from "@/lib/ui/filtros-leads";
import { getCurrentRol } from "@/server/auth/guards";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import { getTagsAdminServiceForRequest } from "@/server/bootstrap/tags-bootstrap";
import { borrarTagAction, crearTagAction, editarTagAction } from "./_actions/etiquetas.actions";
import type { ValorParam } from "@/lib/ui/filtros-leads";
import type { LeadListItem } from "@/types/leads";

export const dynamic = "force-dynamic";

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Altas de los últimos 7 días: se mide sobre `createdAt`, no sobre `updatedAt`,
 * porque el handoff cuenta leads nuevos y no leads con movimiento. Vive fuera
 * del componente: leer el reloj dentro del render viola `react-hooks/purity`.
 */
function contarNuevosEstaSemana(items: LeadListItem[]): number {
  const desde = Date.now() - SEMANA_MS;
  return items.filter((i) => new Date(i.createdAt).getTime() >= desde).length;
}

/**
 * El subtítulo cambia de pregunta cuando hay un filtro puesto.
 *
 * "N nuevos esta semana" se mide sobre las filas que quedaron, así que con un
 * filtro encima deja de ser el pulso del negocio y pasa a ser un recorte del
 * recorte: quien filtra por "perdidos por precio" no está preguntando cuántos
 * leads entraron. Con filtro se informa el tamaño del resultado, que es lo que
 * la pantalla está mostrando de verdad.
 */
function subtitulo(items: LeadListItem[], hayFiltros: boolean): string {
  const conSesion = items.filter((i) => i.sesionActiva).length;
  const cola = `${conSesion.toLocaleString("es-AR")} con sesión activa`;
  if (hayFiltros) {
    const n = items.length;
    return `${n.toLocaleString("es-AR")} ${n === 1 ? "resultado" : "resultados"} · ${cola}`;
  }
  return `${contarNuevosEstaSemana(items).toLocaleString("es-AR")} nuevos esta semana · ${cola}`;
}

/** Los filtros vigentes menos `q`: lo que el buscador tiene que arrastrar. */
function filtrosEnLaUrl(params: Record<string, ValorParam>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(params)) {
    if (clave !== PARAM.q && typeof valor === "string") out[clave] = valor;
  }
  return out;
}

/** El link del banner conserva el resto de los filtros: todos son combinables. */
function hrefDuplicados(params: Record<string, ValorParam>, activo: boolean): string {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (typeof valor === "string") query.set(clave, valor);
  }
  if (activo) query.delete(PARAM.duplicados);
  else query.set(PARAM.duplicados, "1");
  const s = query.toString();
  return s ? `/leads?${s}` : "/leads";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, ValorParam>>;
}) {
  const params = await searchParams;
  // Param repetido o inválido → sin filtro, no error (patrón inbox/productos).
  const filtros = parseFiltrosLeads(params);

  const svc = await getLeadsServiceForRequest();
  // El catálogo de etiquetas con su uso lo pide el modal de administración. Va
  // en el mismo `Promise.all` que el resto: en serie sumaría un viaje a la DB
  // en cada render de la lista.
  const tagsSvc = await getTagsAdminServiceForRequest();
  const [rol, page, etiquetas] = await Promise.all([
    getCurrentRol(),
    svc.listLeads(filtros),
    tagsSvc.listar(),
  ]);

  const hayChips = contarFiltrosActivos(filtros) > 0;
  // La búsqueda recorta tanto como un chip: para el subtítulo cuenta igual.
  const hayRecorte = hayChips || filtros.q !== undefined;

  return (
    // `h-full` y no `h-screen`: el shell del panel ya mide la pantalla, y
    // anidar otro alto de viewport empuja el pie fuera del área scrolleable.
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Leads"
        subtitle={subtitulo(page.items, hayRecorte)}
        actions={
          <div className="flex items-center gap-2">
            <SearchField
              action="/leads"
              defaultValue={filtros.q}
              placeholder="Nombre, perfil, teléfono, vehículo o código…"
              label="Buscar leads"
              className="w-[250px]"
              conservar={filtrosEnLaUrl(params)}
            />
            <EtiquetasDialog
              etiquetas={etiquetas}
              isAdmin={rol === "admin"}
              onCrear={crearTagAction}
              onEditar={editarTagAction}
              onBorrar={borrarTagAction}
            />
          </div>
        }
      />
      <FiltrosLeads etiquetas={page.etiquetas} vehiculos={page.vehiculos} motivos={page.motivos} />
      {rol === "admin" ? (
        <DuplicadosBanner
          count={page.pendingPairs}
          activo={filtros.soloDuplicados === true}
          href={hrefDuplicados(params, filtros.soloDuplicados === true)}
        />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <LeadsTable items={page.items} q={filtros.q} hayFiltros={hayChips} />
      </div>
    </div>
  );
}
