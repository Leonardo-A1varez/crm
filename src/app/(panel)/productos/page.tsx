import Link from "next/link";
import { getLogger } from "@/lib/observability/get-logger";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getErpSyncServiceForRequest } from "@/server/bootstrap/erp-sync-bootstrap";
import { getUsuariosServiceForRequest } from "@/server/bootstrap/usuarios-bootstrap";
import { getBusquedasSinResultadoServiceForRequest } from "@/server/bootstrap/busquedas-sin-resultado-bootstrap";
import { DIAS_POR_DEFECTO } from "@/server/services/catalog/busquedas-sin-resultado.service";
import {
  AvisoSincronizacionErp,
  type EstadoErpSerializado,
} from "@/components/productos/AvisoSincronizacionErp";
import { BusquedasSinResultado } from "@/components/productos/BusquedasSinResultado";
import { VistasProductos } from "@/components/productos/VistasProductos";
import { BuscadorProductos } from "@/components/productos/filtros/BuscadorProductos";
import { FiltrosActivos } from "@/components/productos/filtros/FiltrosActivos";
import { FiltrosProductosProvider } from "@/components/productos/filtros/FiltrosProductosProvider";
import { CatalogoProductos } from "@/components/productos/CatalogoProductos";
import { ProductoFormDialog } from "@/components/productos/ProductoFormDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { getCurrentRol } from "@/server/auth/guards";
import { createProductoAction } from "./_actions/create-producto.action";
import { setProductoActivoAction } from "./_actions/set-producto-activo.action";
import { updateProductoAction } from "./_actions/update-producto.action";

export const dynamic = "force-dynamic";

/**
 * Lo que la pantalla necesita de la sincronización con el ERP y del usuario: el estado
 * del último ciclo (para el aviso de arriba) y la empresa del usuario (para resaltar su
 * columna de precio). Cada lectura falla por su lado y no tumba el catálogo: sin aviso
 * o sin resalte la tabla sirve igual.
 */
async function leerContextoErp(): Promise<{
  empresaErp: number | null;
  sincronizacion: EstadoErpSerializado | null;
}> {
  const logger = getLogger({ scope: "productos" });

  const sincronizacion = await (async () => {
    try {
      const estado = await (await getErpSyncServiceForRequest()).estado();
      return {
        ultimoExito: estado?.ultimo_exito?.toISOString() ?? null,
        huboError: (estado?.ultimo_error ?? "").trim() !== "",
        ahora: new Date().toISOString(),
      };
    } catch (e) {
      logger.warn("productos.erp_sync.lectura_fallo", {
        tipo: e instanceof Error ? e.name : typeof e,
      });
      return null;
    }
  })();

  const empresaErp = await (async () => {
    try {
      const usuario = await getAuthenticatedUser();
      if (usuario === null) return null;
      const equipo = await (await getUsuariosServiceForRequest()).listar();
      return equipo.find((u) => u.id === usuario.id)?.empresa_erp ?? null;
    } catch (e) {
      logger.warn("productos.empresa_erp.lectura_fallo", {
        tipo: e instanceof Error ? e.name : typeof e,
      });
      return null;
    }
  })();

  return { empresaErp, sincronizacion };
}

/**
 * Catálogo de productos. La página no lee los filtros ni las filas: son de la URL y de
 * los dos `GET` de `/api/productos/*`, que el navegador pide por lotes y junta. Acá solo
 * se decide quién ve los botones de administración.
 */
export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string | string[] }>;
}) {
  const isAdmin = (await getCurrentRol()) === "admin";
  const { vista } = await searchParams;
  const { empresaErp, sincronizacion } = await leerContextoErp();

  // "Sin resultado": lo que el agente buscó y el catálogo no tuvo. Solo admin.
  if (isAdmin && vista === "sin-resultado") {
    const service = await getBusquedasSinResultadoServiceForRequest();
    const filas = await service.listar({ dias: DIAS_POR_DEFECTO });
    return (
      <div className="bg-surface-root flex h-full flex-col overflow-hidden">
        <PageHeader
          title="Productos"
          subtitle="Lo que el agente buscó y el catálogo no tuvo"
          actions={<VistasProductos activa="sin-resultado" />}
        />
        <BusquedasSinResultado filas={filas} dias={DIAS_POR_DEFECTO} />
      </div>
    );
  }

  return (
    // El proveedor envuelve también el encabezado: el alta de "Nuevo producto" vive ahí y
    // tiene que poder pedirle a la tabla que vuelva a leer el catálogo.
    <FiltrosProductosProvider>
      {/* `h-full` y no `h-screen`: el shell del panel ya mide la pantalla. */}
      <div className="bg-surface-root flex h-full flex-col overflow-hidden">
        <PageHeader
          title="Productos"
          subtitle={
            <>
              El catálogo que el agente consulta para cotizar
              {sincronizacion !== null ? (
                <>
                  <span aria-hidden> · </span>
                  <AvisoSincronizacionErp estado={sincronizacion} />
                </>
              ) : null}
            </>
          }
          actions={
            isAdmin ? (
              <>
                <VistasProductos activa="catalogo" />
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
        <BuscadorProductos />
        <FiltrosActivos />
        <CatalogoProductos
          isAdmin={isAdmin}
          empresaErp={empresaErp}
          onUpdate={updateProductoAction}
          onToggleActivo={setProductoActivoAction}
        />
      </div>
    </FiltrosProductosProvider>
  );
}
