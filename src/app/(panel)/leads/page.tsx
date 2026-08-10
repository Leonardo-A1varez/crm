import { DuplicadosBanner } from "@/components/leads/DuplicadosBanner";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchField } from "@/components/shared/SearchField";
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
    // `h-full` y no `h-screen`: el shell del panel ya mide la pantalla, y
    // anidar otro alto de viewport empuja el pie fuera del área scrolleable.
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader title="Leads" meta={`${page.items.length} leads`} />
      {rol === "admin" ? (
        <DuplicadosBanner count={page.pendingPairs} activo={soloDuplicados} />
      ) : null}
      <SearchField
        action="/leads"
        defaultValue={q}
        placeholder="Buscar por nombre o teléfono…"
        label="Buscar leads"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <LeadsTable items={page.items} q={q?.trim() || undefined} />
      </div>
    </div>
  );
}
