import { DuplicadosBanner } from "@/components/leads/DuplicadosBanner";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchField } from "@/components/shared/SearchField";
import { getCurrentRol } from "@/server/auth/guards";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import type { LeadListItem } from "@/types/leads";

export const dynamic = "force-dynamic";

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Altas de los últimos 7 días: se mide sobre `createdAt`, no sobre `updatedAt`,
 * porque el handoff cuenta leads nuevos y no leads con movimiento. Vive fuera
 * del componente: leer el reloj dentro del render viola `react-hooks/purity`.
 */
function contarNuevosEstaSemana(items: LeadListItem[]): number {
  const desde = Date.now() - SEMANA_MS;
  return items.filter((i) => new Date(i.createdAt).getTime() >= desde).length;
}

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

  const nuevos = contarNuevosEstaSemana(page.items);
  const conSesion = page.items.filter((i) => i.sesionActiva).length;

  return (
    // `h-full` y no `h-screen`: el shell del panel ya mide la pantalla, y
    // anidar otro alto de viewport empuja el pie fuera del área scrolleable.
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Leads"
        subtitle={`${nuevos.toLocaleString("es-AR")} nuevos esta semana · ${conSesion} con sesión activa`}
        actions={
          <SearchField
            action="/leads"
            defaultValue={q}
            placeholder="Buscar por nombre o teléfono…"
            label="Buscar leads"
            className="w-[250px]"
          />
        }
      />
      {rol === "admin" ? (
        <DuplicadosBanner count={page.pendingPairs} activo={soloDuplicados} />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <LeadsTable items={page.items} q={q?.trim() || undefined} />
      </div>
    </div>
  );
}
