import { NotFoundError } from "@/lib/errors";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import type { Lead, MergeCandidate, UUID } from "@/types/entities";

const DEFAULT_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SCORE = 0.7;

export interface DetectCandidatesInput {
  leadId: UUID;
  windowDays?: number;
  now?: () => Date;
}

export interface CandidateProposal {
  src_lead_id: UUID;
  dst_lead_id: UUID;
  similarity_score: number;
  reasons: string[];
}

export interface LeadMergeDetectorService {
  // Detecta candidates para un lead específico sin persistir. Caller decide
  // si llamar `recordCandidate` por cada match.
  findCandidatesFor(input: DetectCandidatesInput): Promise<CandidateProposal[]>;
  recordCandidate(proposal: CandidateProposal): Promise<MergeCandidate | null>;
}

export class DefaultLeadMergeDetectorService implements LeadMergeDetectorService {
  constructor(
    private readonly leads: LeadsRepository,
    private readonly candidates: MergeCandidatesRepository,
  ) {}

  async findCandidatesFor(input: DetectCandidatesInput): Promise<CandidateProposal[]> {
    const target = await this.leads.findById(input.leadId);
    if (!target) {
      throw new NotFoundError(`lead no encontrado: ${input.leadId}`, "lead", input.leadId);
    }
    const targetName = normalize(target.nombre);
    if (targetName.length === 0) return [];

    const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
    const now = (input.now ?? (() => new Date()))();
    const cutoff = new Date(now.getTime() - windowDays * DAY_MS);

    const all = await this.leads.list();
    const out: CandidateProposal[] = [];
    for (const other of all) {
      if (other.id === target.id) continue;
      const matches = scoreMatch(target, other, cutoff);
      if (matches === null) continue;
      const existing = await this.candidates.findAnyPair(target.id, other.id);
      if (existing && existing.status === "approved") continue;
      if (existing && existing.status === "pending") continue;
      out.push(matches);
    }
    return out;
  }

  async recordCandidate(proposal: CandidateProposal): Promise<MergeCandidate | null> {
    const existing = await this.candidates.findAnyPair(proposal.src_lead_id, proposal.dst_lead_id);
    // pending = dedup; rejected = decisión humana, no insistir. approved no
    // sobrevive (CASCADE al borrar el perdedor); superseded es re-proponible.
    if (existing && (existing.status === "pending" || existing.status === "rejected")) {
      return null;
    }
    return this.candidates.create({
      src_lead_id: proposal.src_lead_id,
      dst_lead_id: proposal.dst_lead_id,
      similarity_score: proposal.similarity_score,
      reasons: proposal.reasons,
    });
  }
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function scoreMatch(target: Lead, other: Lead, cutoff: Date): CandidateProposal | null {
  const targetName = normalize(target.nombre);
  const otherName = normalize(other.nombre);
  if (otherName.length === 0) return null;
  if (targetName !== otherName) return null;
  if (target.canal_origen === other.canal_origen) return null;

  // Window check sobre cualquiera de los dos. Si ambos antiguos, skip.
  if (target.created_at < cutoff && other.created_at < cutoff) return null;

  // Vehicle hard-conflict descarta merge (probable lead físico distinto).
  if (
    target.vehiculo_marca &&
    other.vehiculo_marca &&
    normalize(target.vehiculo_marca) !== normalize(other.vehiculo_marca)
  ) {
    return null;
  }
  if (
    target.vehiculo_modelo &&
    other.vehiculo_modelo &&
    normalize(target.vehiculo_modelo) !== normalize(other.vehiculo_modelo)
  ) {
    return null;
  }

  const reasons = ["nombre_exacto", "canales_distintos"];
  return {
    src_lead_id: target.id,
    dst_lead_id: other.id,
    similarity_score: DEFAULT_SCORE,
    reasons,
  };
}
