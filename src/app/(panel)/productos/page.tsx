import Link from "next/link";
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
 * Catálogo de productos. La página no lee los filtros ni las filas: son de la URL y de
 * los dos `GET` de `/api/productos/*`, que el navegador pide por lotes y junta. Acá solo
 * se decide quién ve los botones de administración.
 */
export default async function ProductosPage() {
  const isAdmin = (await getCurrentRol()) === "admin";

  return (
    // El proveedor envuelve también el encabezado: el alta de "Nuevo producto" vive ahí y
    // tiene que poder pedirle a la tabla que vuelva a leer el catálogo.
    <FiltrosProductosProvider>
      {/* `h-full` y no `h-screen`: el shell del panel ya mide la pantalla. */}
      <div className="bg-surface-root flex h-full flex-col overflow-hidden">
        <PageHeader
          title="Productos"
          subtitle="El catálogo que el agente consulta para cotizar"
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
        <BuscadorProductos />
        <FiltrosActivos />
        <CatalogoProductos
          isAdmin={isAdmin}
          onUpdate={updateProductoAction}
          onToggleActivo={setProductoActivoAction}
        />
      </div>
    </FiltrosProductosProvider>
  );
}
