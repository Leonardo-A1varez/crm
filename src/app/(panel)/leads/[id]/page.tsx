import Link from "next/link";
import { notFound } from "next/navigation";
import { DuplicadosSection } from "@/components/leads/DuplicadosSection";
import { FusionesSection } from "@/components/leads/FusionesSection";
import { LeadFicha } from "@/components/leads/LeadFicha";
import { MarcarDuplicadoDialog } from "@/components/leads/MarcarDuplicadoDialog";
import { SesionesHistorial } from "@/components/leads/SesionesHistorial";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { PageHeader } from "@/components/shared/PageHeader";
import { NotFoundError } from "@/lib/errors";
import { getCurrentRol } from "@/server/auth/guards";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import { approveMergeAction } from "../_actions/approve-merge.action";
import { createManualCandidateAction } from "../_actions/create-manual-candidate.action";
import { quitarRequiereHumanoAction } from "../_actions/quitar-requiere-humano.action";
import { rejectMergeAction } from "../_actions/reject-merge.action";
import { revertMergeAction } from "../_actions/revert-merge.action";
import { searchLeadsAction } from "../_actions/search-leads.action";
import { updateLeadProfileAction } from "../_actions/update-lead-profile.action";
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
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title={detail.lead.nombre}
        actions={
          <>
            <Link
              href="/leads"
              className="border-line-control text-ink-secondary hover:bg-surface-hover inline-flex items-center rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-semibold transition-colors"
            >
              ← Leads
            </Link>
            {detail.sesionActiva ? (
              <Link
                href={`/inbox/${detail.lead.id}`}
                className="bg-brand text-brand-ink inline-flex items-center rounded-[9px] px-[11px] py-1.5 text-[11.5px] font-semibold"
              >
                Abrir conversación
              </Link>
            ) : null}
            {isAdmin ? (
              <MarcarDuplicadoDialog
                leadId={detail.lead.id}
                onSearch={searchLeadsAction}
                onCreate={createManualCandidateAction}
              />
            ) : null}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <LeadFicha
          lead={detail.lead}
          tags={detail.tags}
          // Solo la sesión abierta puede estar escalada: una cerrada es
          // historial y su etapa quedó congelada donde terminó.
          requiereHumano={
            detail.sesionActiva?.current_stage === "requiere_humano"
              ? { sessionId: detail.sesionActiva.id }
              : null
          }
          onUpdate={updateLeadProfileAction}
          onQuitarRequiereHumano={quitarRequiereHumanoAction}
        />
        <div className="border-line-layout border-t px-5 pt-4 pb-1">
          <Eyebrow>Sesiones ({detail.sesiones.length})</Eyebrow>
        </div>
        <SesionesHistorial sesiones={detail.sesiones} />
        {isAdmin ? (
          <>
            <DuplicadosSection
              leadActual={detail.lead}
              duplicados={detail.duplicados}
              onApprove={approveMergeAction}
              onReject={rejectMergeAction}
            />
            <FusionesSection fusiones={detail.fusiones} onRevert={revertMergeAction} />
          </>
        ) : null}
      </div>
    </div>
  );
}
