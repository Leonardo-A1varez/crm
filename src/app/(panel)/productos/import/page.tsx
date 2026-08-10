import Link from "next/link";
import { redirect } from "next/navigation";
import { ImportCsv } from "@/components/productos/ImportCsv";
import { PageHeader } from "@/components/shared/PageHeader";
import { getCurrentRol } from "@/server/auth/guards";
import { confirmImportCsvAction, previewImportCsvAction } from "./_actions/import.actions";

export const dynamic = "force-dynamic";

export default async function ProductosImportPage() {
  // Gate UI server-side; RLS enforcea igual si alguien llega a la action.
  const rol = await getCurrentRol();
  if (rol !== "admin") redirect("/productos");

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Importar catálogo (CSV)"
        actions={
          <Link
            href="/productos"
            className="border-line-control text-ink-secondary hover:bg-surface-hover inline-flex items-center rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-semibold transition-colors"
          >
            ← Volver a productos
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <ImportCsv onPreview={previewImportCsvAction} onConfirm={confirmImportCsvAction} />
      </div>
    </div>
  );
}
