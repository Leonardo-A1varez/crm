import Link from "next/link";
import { redirect } from "next/navigation";
import { ImportCsv } from "@/components/productos/ImportCsv";
import { getCurrentRol } from "@/server/auth/guards";
import { confirmImportCsvAction, previewImportCsvAction } from "./_actions/import.actions";

export const dynamic = "force-dynamic";

export default async function ProductosImportPage() {
  // Gate UI server-side; RLS enforcea igual si alguien llega a la action.
  const rol = await getCurrentRol();
  if (rol !== "admin") redirect("/productos");

  return (
    <div className="flex h-screen flex-col">
      <header className="border-border flex items-center gap-3 border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Importar catálogo (CSV)</h1>
        <Link href="/productos" className="text-muted-foreground text-sm hover:underline">
          ← Volver a productos
        </Link>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <ImportCsv onPreview={previewImportCsvAction} onConfirm={confirmImportCsvAction} />
      </div>
    </div>
  );
}
