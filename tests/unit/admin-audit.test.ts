import { beforeEach, describe, expect, test } from "vitest";
import {
  InMemoryAdminAuditRepository,
  NoopAdminAuditRepository,
} from "@/server/repositories/admin-audit.repo";
import { ADMIN_ACTIONS, DefaultAdminAuditService } from "@/server/services/admin-audit.service";

describe("InMemoryAdminAuditRepository", () => {
  let repo: InMemoryAdminAuditRepository;

  beforeEach(() => {
    repo = new InMemoryAdminAuditRepository();
  });

  test("create asigna id + created_at + persiste payload default {}", async () => {
    const row = await repo.create({
      actor_user_id: "user-1",
      action: ADMIN_ACTIONS.INTENT_ACTIVATE,
      entity_type: "intent",
      entity_id: "intent-1",
    });
    expect(row.id).toBeTypeOf("string");
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.payload).toEqual({});
  });

  test("create con payload persiste", async () => {
    const row = await repo.create({
      actor_user_id: "user-1",
      action: ADMIN_ACTIONS.RULE_UPDATE,
      entity_type: "regla",
      entity_id: "rule-1",
      payload: { prioridad_before: 0, prioridad_after: 10 },
    });
    expect(row.payload).toEqual({ prioridad_before: 0, prioridad_after: 10 });
  });

  test("create con actor_user_id null permitido (sistema)", async () => {
    const row = await repo.create({
      actor_user_id: null,
      action: "system.purge",
      entity_type: "lead_session",
      entity_id: null,
    });
    expect(row.actor_user_id).toBeNull();
  });

  test("list filtra por actorUserId", async () => {
    await repo.create({
      actor_user_id: "u1",
      action: "x",
      entity_type: "y",
      entity_id: null,
    });
    await repo.create({
      actor_user_id: "u2",
      action: "x",
      entity_type: "y",
      entity_id: null,
    });
    const u1Actions = await repo.list({ actorUserId: "u1" });
    expect(u1Actions).toHaveLength(1);
    expect(u1Actions[0].actor_user_id).toBe("u1");
  });

  test("list filtra por entityType + entityId", async () => {
    await repo.create({
      actor_user_id: "u1",
      action: "x",
      entity_type: "intent",
      entity_id: "i1",
    });
    await repo.create({
      actor_user_id: "u1",
      action: "x",
      entity_type: "intent",
      entity_id: "i2",
    });
    await repo.create({
      actor_user_id: "u1",
      action: "x",
      entity_type: "regla",
      entity_id: "r1",
    });
    const intentRows = await repo.list({ entityType: "intent" });
    expect(intentRows).toHaveLength(2);
    const specific = await repo.list({ entityType: "intent", entityId: "i1" });
    expect(specific).toHaveLength(1);
  });

  test("list orden created_at DESC", async () => {
    const a = await repo.create({
      actor_user_id: "u",
      action: "x",
      entity_type: "y",
      entity_id: null,
    });
    await new Promise((r) => setTimeout(r, 5));
    const b = await repo.create({
      actor_user_id: "u",
      action: "x",
      entity_type: "y",
      entity_id: null,
    });
    const list = await repo.list();
    expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  test("list respeta limit", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create({
        actor_user_id: "u",
        action: "x",
        entity_type: "y",
        entity_id: null,
      });
      await new Promise((r) => setTimeout(r, 1));
    }
    const list = await repo.list({ limit: 2 });
    expect(list).toHaveLength(2);
  });

  test("payload deep-clone defense", async () => {
    const payload = { nested: { v: 1 } };
    const row = await repo.create({
      actor_user_id: null,
      action: "x",
      entity_type: "y",
      entity_id: null,
      payload,
    });
    (row.payload.nested as { v: number }).v = 999;

    const refetch = await repo.findById(row.id);
    expect((refetch!.payload.nested as { v: number }).v).toBe(1);
  });
});

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
