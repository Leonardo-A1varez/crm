import { describe, expect, test } from "vitest";
import {
  InMemoryAdminAuditRepository,
  NoopAdminAuditRepository,
} from "@/server/repositories/admin-audit.repo";
import { ADMIN_ACTIONS, DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { runAdminAuditContract } from "../repositories/admin-audit.contract";

runAdminAuditContract(() => new InMemoryAdminAuditRepository());

describe("NoopAdminAuditRepository", () => {
  test("create retorna objeto pero no persiste", async () => {
    const repo = new NoopAdminAuditRepository();
    const row = await repo.create({
      actor_user_id: "u",
      action: "x",
      entity_type: "y",
      entity_id: null,
    });
    expect(row.id).toBeTypeOf("string");
    expect(await repo.findById(row.id)).toBeNull();
    expect(await repo.list()).toEqual([]);
  });
});

describe("DefaultAdminAuditService.recordAction", () => {
  test("delega a repo con shape correcto", async () => {
    const repo = new InMemoryAdminAuditRepository();
    const svc = new DefaultAdminAuditService(repo);

    const row = await svc.recordAction({
      actorUserId: "u1",
      action: ADMIN_ACTIONS.LEAD_MERGE,
      entityType: "lead",
      entityId: "dst-lead",
      payload: { src: "src-lead" },
    });

    expect(row.action).toBe("lead.merge");
    expect(row.entity_id).toBe("dst-lead");
    expect(row.payload).toEqual({ src: "src-lead" });
  });

  test("entityId opcional default null", async () => {
    const repo = new InMemoryAdminAuditRepository();
    const svc = new DefaultAdminAuditService(repo);
    const row = await svc.recordAction({
      actorUserId: null,
      action: ADMIN_ACTIONS.PRODUCT_IMPORT,
      entityType: "producto",
    });
    expect(row.entity_id).toBeNull();
  });
});

describe("ADMIN_ACTIONS catalog", () => {
  test("expone constantes esperadas", () => {
    expect(ADMIN_ACTIONS.INTENT_ACTIVATE).toBe("intent.activate");
    expect(ADMIN_ACTIONS.LEAD_MERGE).toBe("lead.merge");
    expect(ADMIN_ACTIONS.SESSION_PAUSE_IA).toBe("session.pause_ia");
  });
});
