import Link from "next/link";
import { ProductoFormDialog } from "@/components/productos/ProductoFormDialog";
import { ProductosTable } from "@/components/productos/ProductosTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchField } from "@/components/shared/SearchField";
import { getCurrentRol } from "@/server/auth/guards";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { createProductoAction } from "./_actions/create-producto.action";
import { setProductoActivoAction } from "./_actions/set-producto-activo.action";
import { updateProductoAction } from "./_actions/update-producto.action";

export const dynamic = "force-dynamic";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  // Param repetido (?q=a&q=b) o inválido → sin filtro, no error (patrón inbox).
  const q = typeof params.q === "string" ? params.q : undefined;
  const svc = await getCatalogServiceForRequest();
  const [rol, productos] = await Promise.all([getCurrentRol(), svc.listProductos({ q })]);
  const isAdmin = rol === "admin";

  return (
    // `h-full` y no `h-screen`: el shell del panel ya mide la pantalla.
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Productos"
        meta={`${productos.length} productos`}
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
      <SearchField
        action="/productos"
        defaultValue={q}
        placeholder="Buscar por código o nombre…"
        label="Buscar productos"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ProductosTable
          productos={productos}
          isAdmin={isAdmin}
          onUpdate={updateProductoAction}
          onToggleActivo={setProductoActivoAction}
        />
      </div>
    </div>
  );
}
