import Form from "next/form";
import { DuplicadosBanner } from "@/components/leads/DuplicadosBanner";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { Input } from "@/components/ui/input";
import { getCurrentRol } from "@/server/auth/guards";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; duplicados?: string | string[] }>;
}) {
  const params = await searchParams;
  // Param repetido o inválido → sin filtro, no error (patrón inbox/productos).
  const q = typeof params.q === "string" ? params.q : undefined;
  const soloDuplicados = typeof params.duplicados === "string" && params.duplicados === "1";

  const svc = await getLeadsServiceForRequest();
  const [rol, page] = await Promise.all([getCurrentRol(), svc.listLeads({ q, soloDuplicados })]);

  return (
    <div className="flex h-screen flex-col">
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Leads</h1>
        <span className="text-muted-foreground text-xs">{page.items.length} leads</span>
      </header>
      {rol === "admin" ? (
        <DuplicadosBanner count={page.pendingPairs} activo={soloDuplicados} />
      ) : null}
      <div className="border-border border-b px-4 py-2">
        <Form action="/leads">
          <Input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Buscar por nombre o teléfono…"
            className="max-w-sm"
            aria-label="Buscar leads"
          />
        </Form>
      </div>
      <div className="flex-1 overflow-y-auto">
        <LeadsTable items={page.items} q={q?.trim() || undefined} />
      </div>
    </div>
  );
}
