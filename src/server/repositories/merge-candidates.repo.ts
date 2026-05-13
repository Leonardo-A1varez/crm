import { ConflictError, NotFoundError } from "@/lib/errors";
import type { MergeCandidateStatus } from "@/types/domain";
import type { MergeCandidate, UUID } from "@/types/entities";

export type MergeCandidateInsert = Omit<
  MergeCandidate,
  "id" | "created_at" | "status" | "resolved_by" | "resolved_at"
> & {
  status?: MergeCandidateStatus;
};

export interface MergeCandidatesListFilter {
  status?: MergeCandidateStatus;
  limit?: number;
}

export interface MergeCandidatesRepository {
  // Insert pending. Throws ConflictError si ya existe pending (par orden-independiente).
  create(input: MergeCandidateInsert): Promise<MergeCandidate>;
  findById(id: UUID): Promise<MergeCandidate | null>;
  findPendingPair(a: UUID, b: UUID): Promise<MergeCandidate | null>;
  // Cualquier registro (pending o resuelto) entre par (orden-independiente).
  findAnyPair(a: UUID, b: UUID): Promise<MergeCandidate | null>;
  resolve(
    id: UUID,
    status: Exclude<MergeCandidateStatus, "pending">,
    resolvedBy: UUID | null,
  ): Promise<MergeCandidate>;
  list(filter?: MergeCandidatesListFilter): Promise<MergeCandidate[]>;
}

function cloneCandidate(c: MergeCandidate): MergeCandidate {
  return { ...c, reasons: [...c.reasons] };
}

function pairKey(a: UUID, b: UUID): string {
  return [a, b].sort().join("|");
}

export class InMemoryMergeCandidatesRepository implements MergeCandidatesRepository {
  private readonly store = new Map<UUID, MergeCandidate>();

  async create(input: MergeCandidateInsert): Promise<MergeCandidate> {
    if (input.src_lead_id === input.dst_lead_id) {
      throw new ConflictError("merge_candidate self-pair no permitido", "self_pair");
    }
    const pendingDup = await this.findPendingPair(input.src_lead_id, input.dst_lead_id);
    if (pendingDup) {
      throw new ConflictError(
        `merge_candidate pending ya existe para par`,
        "duplicate_pending_pair",
      );
    }
    const row: MergeCandidate = {
      ...input,
      reasons: [...input.reasons],
      status: input.status ?? "pending",
      resolved_by: null,
      resolved_at: null,
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
    this.store.set(row.id, row);
    return cloneCandidate(row);
  }

  async findById(id: UUID): Promise<MergeCandidate | null> {
    const c = this.store.get(id);
    return c ? cloneCandidate(c) : null;
  }

  async findPendingPair(a: UUID, b: UUID): Promise<MergeCandidate | null> {
    const key = pairKey(a, b);
    for (const c of this.store.values()) {
      if (c.status === "pending" && pairKey(c.src_lead_id, c.dst_lead_id) === key) {
        return cloneCandidate(c);
      }
    }
    return null;
  }

  async findAnyPair(a: UUID, b: UUID): Promise<MergeCandidate | null> {
    const key = pairKey(a, b);
    for (const c of this.store.values()) {
      if (pairKey(c.src_lead_id, c.dst_lead_id) === key) return cloneCandidate(c);
    }
    return null;
  }

  async resolve(
    id: UUID,
    status: Exclude<MergeCandidateStatus, "pending">,
    resolvedBy: UUID | null,
  ): Promise<MergeCandidate> {
    const current = this.store.get(id);
    if (!current) {
      throw new NotFoundError(`merge_candidate no encontrado: ${id}`, "merge_candidate", id);
    }
    if (current.status !== "pending") {
      throw new ConflictError(`merge_candidate ya resuelto: ${id}`, "already_resolved");
    }
    const resolved: MergeCandidate = {
      ...current,
      status,
      resolved_by: resolvedBy,
      resolved_at: new Date(),
    };
    this.store.set(id, resolved);
    return cloneCandidate(resolved);
  }

  async list(filter: MergeCandidatesListFilter = {}): Promise<MergeCandidate[]> {
    let rows = Array.from(this.store.values());
    if (filter.status !== undefined) {
      rows = rows.filter((r) => r.status === filter.status);
    }
    rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    const limit = filter.limit ?? rows.length;
    return rows.slice(0, limit).map(cloneCandidate);
  }
}
