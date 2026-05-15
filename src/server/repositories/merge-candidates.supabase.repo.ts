import { ConflictError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { serverNowIso } from "@/server/db/server-time";
import { isUuid } from "@/server/db/uuid";
import type { MergeCandidateStatus } from "@/types/domain";
import type { MergeCandidate, UUID } from "@/types/entities";
import type {
  MergeCandidateInsert,
  MergeCandidatesListFilter,
  MergeCandidatesRepository,
} from "./merge-candidates.repo";

/**
 * Supabase impl MergeCandidatesRepository. Slice 1 sub-paso 7.4 repo 12.
 *
 * FKs:
 *   - src_lead_id / dst_lead_id → leads.id ON DELETE CASCADE
 *   - resolved_by → usuarios.id ON DELETE SET NULL
 *
 * Constraints:
 *   - CHECK merge_candidates_no_self → src_lead_id <> dst_lead_id
 *   - UNIQUE partial uq_merge_candidates_pending_pair sobre
 *     (LEAST(src,dst), GREATEST(src,dst)) WHERE status='pending'
 *     → orden-independiente, atomic.
 *
 * create pre-checks self-pair antes de DB (ConflictError "self_pair" parity
 * InMemory). DB CHECK 23514 = backup defense.
 */
export class SupabaseMergeCandidatesRepository implements MergeCandidatesRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: MergeCandidateInsert): Promise<MergeCandidate> {
    if (input.src_lead_id === input.dst_lead_id) {
      throw new ConflictError("merge_candidate self-pair no permitido", "self_pair");
    }

    const { data, error } = await this.db
      .from("merge_candidates")
      .insert({
        src_lead_id: input.src_lead_id,
        dst_lead_id: input.dst_lead_id,
        similarity_score: input.similarity_score,
        reasons: input.reasons as never,
        status: input.status ?? "pending",
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        const msg = error.message ?? "";
        if (msg.includes("uq_merge_candidates_pending_pair")) {
          throw new ConflictError(
            "merge_candidate pending ya existe para par",
            "duplicate_pending_pair",
            error,
          );
        }
        throw new ConflictError(msg, "unique_violation", error);
      }
      if (error.code === "23514") {
        // CHECK merge_candidates_no_self — backup vs pre-check (debería ser inalcanzable).
        throw new ConflictError("merge_candidate self-pair no permitido", "self_pair", error);
      }
      throw mapPostgrestError(error, { resource: "merge_candidate" });
    }
    return mapRow(data);
  }

  async findById(id: UUID): Promise<MergeCandidate | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from("merge_candidates")
      .select()
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "merge_candidate" });
    return data ? mapRow(data) : null;
  }

  async findPendingPair(a: UUID, b: UUID): Promise<MergeCandidate | null> {
    if (!isUuid(a) || !isUuid(b)) return null;
    // Orden-independiente: match (src=a AND dst=b) OR (src=b AND dst=a).
    const { data, error } = await this.db
      .from("merge_candidates")
      .select()
      .eq("status", "pending")
      .or(
        `and(src_lead_id.eq.${a},dst_lead_id.eq.${b}),and(src_lead_id.eq.${b},dst_lead_id.eq.${a})`,
      )
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "merge_candidate" });
    return data ? mapRow(data) : null;
  }

  async findAnyPair(a: UUID, b: UUID): Promise<MergeCandidate | null> {
    if (!isUuid(a) || !isUuid(b)) return null;
    const { data, error } = await this.db
      .from("merge_candidates")
      .select()
      .or(
        `and(src_lead_id.eq.${a},dst_lead_id.eq.${b}),and(src_lead_id.eq.${b},dst_lead_id.eq.${a})`,
      )
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "merge_candidate" });
    return data ? mapRow(data) : null;
  }

  async resolve(
    id: UUID,
    status: Exclude<MergeCandidateStatus, "pending">,
    resolvedBy: UUID | null,
  ): Promise<MergeCandidate> {
    const current = await this.findById(id);
    if (!current) {
      throw new NotFoundError(`merge_candidate no encontrado: ${id}`, "merge_candidate", id);
    }
    if (current.status !== "pending") {
      throw new ConflictError(`merge_candidate ya resuelto: ${id}`, "already_resolved");
    }

    const resolvedAt = await serverNowIso(this.db);
    const { data, error } = await this.db
      .from("merge_candidates")
      .update({
        status,
        resolved_by: resolvedBy,
        resolved_at: resolvedAt,
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "merge_candidate" });
    if (data === null) {
      throw new NotFoundError(`merge_candidate no encontrado: ${id}`, "merge_candidate", id);
    }
    return mapRow(data);
  }

  async list(filter: MergeCandidatesListFilter = {}): Promise<MergeCandidate[]> {
    let query = this.db.from("merge_candidates").select().order("created_at", { ascending: false });
    if (filter.status !== undefined) {
      query = query.eq("status", filter.status);
    }
    if (filter.limit !== undefined) {
      query = query.limit(filter.limit);
    }
    const { data, error } = await query;
    if (error) throw mapPostgrestError(error, { resource: "merge_candidate" });
    return (data ?? []).map(mapRow);
  }
}

interface MergeCandidateRow {
  id: string;
  src_lead_id: string;
  dst_lead_id: string;
  similarity_score: number;
  reasons: unknown;
  status: MergeCandidateStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

function mapRow(row: MergeCandidateRow): MergeCandidate {
  const reasons = (row.reasons ?? []) as string[];
  return {
    id: row.id,
    src_lead_id: row.src_lead_id,
    dst_lead_id: row.dst_lead_id,
    similarity_score: row.similarity_score,
    reasons: [...reasons],
    status: row.status,
    resolved_by: row.resolved_by,
    resolved_at: row.resolved_at ? new Date(row.resolved_at) : null,
    created_at: new Date(row.created_at),
  };
}
