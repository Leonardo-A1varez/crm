import type {
  AdminAuditRepository,
  AdminActionInsert,
} from "@/server/repositories/admin-audit.repo";
import type { AdminAction, UUID } from "@/types/entities";

// Catálogo de acciones admin. Mantener centralizado para facilitar audit queries.
export const ADMIN_ACTIONS = {
  INTENT_ACTIVATE: "intent.activate",
  INTENT_DEACTIVATE: "intent.deactivate",
  INTENT_CREATE: "intent.create",
  INTENT_UPDATE: "intent.update",
  RULE_CREATE: "rule.create",
  RULE_UPDATE: "rule.update",
  RULE_DEACTIVATE: "rule.deactivate",
  LEAD_MERGE: "lead.merge",
  LEAD_UPDATE: "lead.update",
  SESSION_PAUSE_IA: "session.pause_ia",
  SESSION_RESUME_IA: "session.resume_ia",
  PRODUCT_IMPORT: "product.import",
  PRODUCT_UPDATE: "product.update",
  TAG_CREATE: "tag.create",
  TAG_UPDATE: "tag.update",
  TAG_DELETE: "tag.delete",
} as const;

export type AdminActionName = (typeof ADMIN_ACTIONS)[keyof typeof ADMIN_ACTIONS] | string;

export interface RecordActionInput {
  actorUserId: UUID | null;
  action: AdminActionName;
  entityType: string;
  entityId?: UUID | null;
  payload?: Record<string, unknown>;
}

export interface AdminAuditService {
  recordAction(input: RecordActionInput): Promise<AdminAction>;
}

export class DefaultAdminAuditService implements AdminAuditService {
  constructor(private readonly repo: AdminAuditRepository) {}

  async recordAction(input: RecordActionInput): Promise<AdminAction> {
    const insert: AdminActionInsert = {
      actor_user_id: input.actorUserId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      payload: input.payload,
    };
    return this.repo.create(insert);
  }
}
