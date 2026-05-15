import { describe, expect, test, beforeEach } from "vitest";
import type { AdminAuditRepository } from "@/server/repositories/admin-audit.repo";
import { ADMIN_ACTIONS } from "@/server/services/admin-audit.service";
import type { UUID } from "@/types/entities";

export interface AdminAuditContractFixtures {
  actorUserIds: { user1: UUID; u1: UUID; u2: UUID; u: UUID };
  entityIds: { intent1: UUID; rule1: UUID; i1: UUID; i2: UUID; r1: UUID };
}

const DEFAULT_FIXTURES: AdminAuditContractFixtures = {
  actorUserIds: { user1: "user-1", u1: "u1", u2: "u2", u: "u" },
  entityIds: { intent1: "intent-1", rule1: "rule-1", i1: "i1", i2: "i2", r1: "r1" },
};

export type AdminAuditContractFixturesArg =
  | AdminAuditContractFixtures
  | (() => AdminAuditContractFixtures);

export function runAdminAuditContract(
  makeRepo: () => AdminAuditRepository,
  fixturesArg: AdminAuditContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("AdminAuditRepository contract", () => {
    let repo: AdminAuditRepository;
    let fixtures: AdminAuditContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create asigna id + created_at + persiste payload default {}", async () => {
      const row = await repo.create({
        actor_user_id: fixtures.actorUserIds.user1,
        action: ADMIN_ACTIONS.INTENT_ACTIVATE,
        entity_type: "intent",
        entity_id: fixtures.entityIds.intent1,
      });
      expect(row.id).toBeTypeOf("string");
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.payload).toEqual({});
    });

    test("create con payload persiste", async () => {
      const row = await repo.create({
        actor_user_id: fixtures.actorUserIds.user1,
        action: ADMIN_ACTIONS.RULE_UPDATE,
        entity_type: "regla",
        entity_id: fixtures.entityIds.rule1,
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
        actor_user_id: fixtures.actorUserIds.u1,
        action: "x",
        entity_type: "y",
        entity_id: null,
      });
      await repo.create({
        actor_user_id: fixtures.actorUserIds.u2,
        action: "x",
        entity_type: "y",
        entity_id: null,
      });
      const u1Actions = await repo.list({ actorUserId: fixtures.actorUserIds.u1 });
      expect(u1Actions).toHaveLength(1);
      expect(u1Actions[0]?.actor_user_id).toBe(fixtures.actorUserIds.u1);
    });

    test("list filtra por entityType + entityId", async () => {
      await repo.create({
        actor_user_id: fixtures.actorUserIds.u1,
        action: "x",
        entity_type: "intent",
        entity_id: fixtures.entityIds.i1,
      });
      await repo.create({
        actor_user_id: fixtures.actorUserIds.u1,
        action: "x",
        entity_type: "intent",
        entity_id: fixtures.entityIds.i2,
      });
      await repo.create({
        actor_user_id: fixtures.actorUserIds.u1,
        action: "x",
        entity_type: "regla",
        entity_id: fixtures.entityIds.r1,
      });
      const intentRows = await repo.list({ entityType: "intent" });
      expect(intentRows).toHaveLength(2);
      const specific = await repo.list({
        entityType: "intent",
        entityId: fixtures.entityIds.i1,
      });
      expect(specific).toHaveLength(1);
    });

    test("list orden created_at DESC", async () => {
      const a = await repo.create({
        actor_user_id: fixtures.actorUserIds.u,
        action: "x",
        entity_type: "y",
        entity_id: null,
      });
      await new Promise((r) => setTimeout(r, 5));
      const b = await repo.create({
        actor_user_id: fixtures.actorUserIds.u,
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
          actor_user_id: fixtures.actorUserIds.u,
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
      expect((refetch?.payload.nested as { v: number }).v).toBe(1);
    });
  });
}
