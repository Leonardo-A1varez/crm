import Form from "next/form";
import { ProductosTable } from "@/components/productos/ProductosTable";
import { Input } from "@/components/ui/input";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";

export const dynamic = "force-dynamic";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const svc = await getCatalogServiceForRequest();
  const productos = await svc.listProductos({ q });

  return (
    <div className="flex h-screen flex-col">
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Productos</h1>
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
        <ProductosTable productos={productos} />
      </div>
    </div>
  );
}
