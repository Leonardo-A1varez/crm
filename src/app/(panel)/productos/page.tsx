import Form from "next/form";
import Link from "next/link";
import { ProductoFormDialog } from "@/components/productos/ProductoFormDialog";
import { ProductosTable } from "@/components/productos/ProductosTable";
import { Input } from "@/components/ui/input";
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
    <div className="flex h-screen flex-col">
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Productos</h1>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <Link
              href="/productos/import"
              className="border-border hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm"
            >
              Importar CSV
            </Link>
            <ProductoFormDialog
              title="Nuevo producto"
              description="Alta manual de catálogo. Para volumen usá Importar CSV."
              triggerLabel="Nuevo producto"
              onSubmit={createProductoAction}
            />
          </div>
        ) : null}
      </header>
      <div className="border-border border-b px-4 py-2">
        <Form action="/productos">
          <Input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Buscar por código o nombre…"
            className="max-w-sm"
            aria-label="Buscar productos"
          />
        </Form>
      </div>
      <div className="flex-1 overflow-y-auto">
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
