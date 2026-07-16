import Link from "next/link";
import { notFound } from "next/navigation";
import { DuplicadosSection } from "@/components/leads/DuplicadosSection";
import { LeadFicha } from "@/components/leads/LeadFicha";
import { MarcarDuplicadoDialog } from "@/components/leads/MarcarDuplicadoDialog";
import { SesionesHistorial } from "@/components/leads/SesionesHistorial";
import { Button } from "@/components/ui/button";
import { NotFoundError } from "@/lib/errors";
import { getCurrentRol } from "@/server/auth/guards";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import { approveMergeAction } from "../_actions/approve-merge.action";
import { createManualCandidateAction } from "../_actions/create-manual-candidate.action";
import { rejectMergeAction } from "../_actions/reject-merge.action";
import { searchLeadsAction } from "../_actions/search-leads.action";
import type { LeadDetail } from "@/types/leads";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const svc = await getLeadsServiceForRequest();

  let detail: LeadDetail;
  let isAdmin: boolean;
  try {
    const [d, rol] = await Promise.all([svc.getLeadDetail(id), getCurrentRol()]);
    detail = d;
    isAdmin = rol === "admin";
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="border-border flex items-center gap-3 border-b px-4 py-3">
        <Link href="/leads" className="text-muted-foreground text-sm hover:underline">
          ← Leads
        </Link>
        <h1 className="text-lg font-semibold">{detail.lead.nombre}</h1>
        {detail.sesionActiva ? (
          <Button size="sm" render={<Link href={`/inbox/${detail.lead.id}`} />}>
            Abrir conversación
          </Button>
        ) : null}
        {isAdmin ? (
          <MarcarDuplicadoDialog
            leadId={detail.lead.id}
            onSearch={searchLeadsAction}
            onCreate={createManualCandidateAction}
          />
        ) : null}
      </header>
      <div className="flex-1 overflow-y-auto">
        <LeadFicha lead={detail.lead} tags={detail.tags} />
        <h3 className="border-border border-t px-4 pt-4 text-sm font-medium">
          Sesiones ({detail.sesiones.length})
        </h3>
        <SesionesHistorial sesiones={detail.sesiones} />
        {isAdmin ? (
          <DuplicadosSection
            leadActual={detail.lead}
            duplicados={detail.duplicados}
            onApprove={approveMergeAction}
            onReject={rejectMergeAction}
          />
        ) : null}
      </div>
    </div>
  );
}
