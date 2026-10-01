import Link from "next/link";
import { redirect } from "next/navigation";
import { Inventory2 } from "@/components/icons";
import { BuscadorProductos } from "@/components/productos/filtros/BuscadorProductos";
import { FiltrosActivos } from "@/components/productos/filtros/FiltrosActivos";
import { FiltrosProductosProvider } from "@/components/productos/filtros/FiltrosProductosProvider";
import { RegionTabla } from "@/components/productos/filtros/RegionTabla";
import { PaginacionProductos } from "@/components/productos/PaginacionProductos";
import { ProductoFormDialog } from "@/components/productos/ProductoFormDialog";
import { ProductosTable } from "@/components/productos/ProductosTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ValidationError } from "@/lib/errors";
import {
  aUrlSearchParams,
  conPagina,
  hayFiltros,
  hrefCon,
  leerFiltros,
  mensajesDeFiltrosInvalidos,
  rangoDePagina,
} from "@/lib/ui/filtros-productos";
import { getCurrentRol } from "@/server/auth/guards";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { createProductoAction } from "./_actions/create-producto.action";
import { facetasProductosAction } from "./_actions/facetas-productos.action";
import { setProductoActivoAction } from "./_actions/set-producto-activo.action";
import { updateProductoAction } from "./_actions/update-producto.action";
import type { VistaProductos } from "@/components/productos/ProductosTable";
import type { ProductosPagina } from "@/types/productos";

export const dynamic = "force-dynamic";

const numeroFmt = new Intl.NumberFormat("es-AR");

type Busqueda = { ok: true; pagina: ProductosPagina } | { ok: false; mensajes: string[] };

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = aUrlSearchParams(params);
  const filtrado = hayFiltros(leerFiltros(query));

  const svc = await getCatalogServiceForRequest();
  // El service valida los `searchParams` tal cual llegan. Un valor que no pasa
  // (rango invertido, más de 300 valores…) no tumba la pantalla: se explica en
  // la tabla, con el encabezado y los chips a la vista para corregirlo.
  const buscar = async (): Promise<Busqueda> => {
    try {
      return { ok: true, pagina: await svc.buscarProductos(params) };
    } catch (e) {
      if (e instanceof ValidationError) {
        return { ok: false, mensajes: mensajesDeFiltrosInvalidos(e.issues) };
      }
      throw e;
    }
  };
  const [rol, busqueda] = await Promise.all([getCurrentRol(), buscar()]);
  const isAdmin = rol === "admin";

  // Una página más allá de la última (un link viejo, o filtros que dejaron menos
  // resultados) vuelve a la última que existe en vez de mostrar la tabla vacía.
  if (busqueda.ok && busqueda.pagina.items.length === 0 && busqueda.pagina.total > 0) {
    const { totalPaginas } = rangoDePagina(
      busqueda.pagina.total,
      busqueda.pagina.pagina,
      busqueda.pagina.porPagina,
    );
    redirect(hrefCon("/productos", conPagina(query, totalPaginas)));
  }

  const sinCatalogo = busqueda.ok && busqueda.pagina.total === 0 && !filtrado;
  const vista: VistaProductos = !busqueda.ok
    ? { tipo: "invalido", mensajes: busqueda.mensajes }
    : busqueda.pagina.items.length === 0
      ? { tipo: "sin-resultados" }
      : { tipo: "filas", productos: busqueda.pagina.items };

  const subtitulo = !busqueda.ok
    ? "Filtros no válidos"
    : `${numeroFmt.format(busqueda.pagina.total)} ${busqueda.pagina.total === 1 ? "producto" : "productos"}${filtrado ? " con los filtros aplicados" : ""}`;

  return (
    // `h-full` y no `h-screen`: el shell del panel ya mide la pantalla.
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Productos"
        subtitle={subtitulo}
        actions={
          isAdmin ? (
            <>
              <Link
                href="/productos/import"
                className="border-line-control text-ink-secondary hover:bg-surface-hover inline-flex items-center rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-semibold transition-colors"
              >
                Importar CSV
              </Link>
              <ProductoFormDialog
                title="Nuevo producto"
                description="Alta manual de catálogo. Para volumen usá Importar CSV."
                triggerLabel="Nuevo producto"
                onSubmit={createProductoAction}
              />
            </>
          ) : null
        }
      />
      {sinCatalogo ? (
        <EmptyState
          icon={<Inventory2 size={34} strokeWidth={1.4} />}
          title="Sin productos"
          description="Cargá el catálogo a mano o importá un CSV para que el agente pueda cotizar."
        />
      ) : (
        <FiltrosProductosProvider cargarFacetas={facetasProductosAction}>
          <BuscadorProductos />
          <FiltrosActivos />
          <RegionTabla clave={query.toString()}>
            <ProductosTable
              vista={vista}
              isAdmin={isAdmin}
              onUpdate={updateProductoAction}
              onToggleActivo={setProductoActivoAction}
            />
          </RegionTabla>
          {busqueda.ok ? (
            <PaginacionProductos
              pathname="/productos"
              query={query}
              total={busqueda.pagina.total}
              pagina={busqueda.pagina.pagina}
              porPagina={busqueda.pagina.porPagina}
            />
          ) : null}
        </FiltrosProductosProvider>
      )}
    </div>
  );
}
