import { describe, expect, test, beforeEach } from "vitest";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { MergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import type { UUID } from "@/types/entities";

export interface MergeCandidatesContractFixtures {
  leadIds: {
    a: UUID;
    b: UUID;
    x: UUID;
    one: UUID;
    two: UUID;
    three: UUID;
    four: UUID;
  };
  userIds: { user1: UUID };
}

const DEFAULT_FIXTURES: MergeCandidatesContractFixtures = {
  leadIds: { a: "a", b: "b", x: "x", one: "1", two: "2", three: "3", four: "4" },
  userIds: { user1: "user-1" },
};

export type MergeCandidatesContractFixturesArg =
  | MergeCandidatesContractFixtures
  | (() => MergeCandidatesContractFixtures);

export function runMergeCandidatesContract(
  makeRepo: () => MergeCandidatesRepository,
  fixturesArg: MergeCandidatesContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("MergeCandidatesRepository contract", () => {
    let repo: MergeCandidatesRepository;
    let fixtures: MergeCandidatesContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create asigna id + status pending por default", async () => {
      const c = await repo.create({
        src_lead_id: fixtures.leadIds.a,
        dst_lead_id: fixtures.leadIds.b,
        similarity_score: 0.7,
        reasons: ["nombre_exacto"],
      });
      expect(c.id).toBeTypeOf("string");
      expect(c.status).toBe("pending");
      expect(c.resolved_by).toBeNull();
      expect(c.resolved_at).toBeNull();
    });

    test("create self-pair lanza ConflictError", async () => {
      await expect(
        repo.create({
          src_lead_id: fixtures.leadIds.x,
          dst_lead_id: fixtures.leadIds.x,
          similarity_score: 1,
          reasons: [],
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    test("create duplicate pending lanza ConflictError (orden-independiente)", async () => {
      await repo.create({
        src_lead_id: fixtures.leadIds.a,
        dst_lead_id: fixtures.leadIds.b,
        similarity_score: 0.7,
        reasons: [],
      });
      await expect(
        repo.create({
          src_lead_id: fixtures.leadIds.b,
          dst_lead_id: fixtures.leadIds.a,
          similarity_score: 0.8,
          reasons: [],
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    test("findPendingPair orden-independiente", async () => {
      const c = await repo.create({
        src_lead_id: fixtures.leadIds.a,
        dst_lead_id: fixtures.leadIds.b,
        similarity_score: 0.7,
        reasons: [],
      });
      expect((await repo.findPendingPair(fixtures.leadIds.a, fixtures.leadIds.b))?.id).toBe(c.id);
      expect((await repo.findPendingPair(fixtures.leadIds.b, fixtures.leadIds.a))?.id).toBe(c.id);
    });

    test("findPendingPair ignora resueltos", async () => {
      const c = await repo.create({
        src_lead_id: fixtures.leadIds.a,
        dst_lead_id: fixtures.leadIds.b,
        similarity_score: 0.7,
        reasons: [],
      });
      await repo.resolve(c.id, "approved", fixtures.userIds.user1);
      expect(await repo.findPendingPair(fixtures.leadIds.a, fixtures.leadIds.b)).toBeNull();
    });

    test("findAnyPair incluye resueltos", async () => {
      const c = await repo.create({
        src_lead_id: fixtures.leadIds.a,
        dst_lead_id: fixtures.leadIds.b,
        similarity_score: 0.7,
        reasons: [],
      });
      await repo.resolve(c.id, "rejected", fixtures.userIds.user1);
      expect((await repo.findAnyPair(fixtures.leadIds.a, fixtures.leadIds.b))?.id).toBe(c.id);
    });

    test("resolve setea status + resolved_by + resolved_at", async () => {
      const c = await repo.create({
        src_lead_id: fixtures.leadIds.a,
        dst_lead_id: fixtures.leadIds.b,
        similarity_score: 0.7,
        reasons: [],
      });
      const r = await repo.resolve(c.id, "approved", fixtures.userIds.user1);
      expect(r.status).toBe("approved");
      expect(r.resolved_by).toBe(fixtures.userIds.user1);
      expect(r.resolved_at).toBeInstanceOf(Date);
    });

    test("resolve sobre ya resuelto lanza ConflictError", async () => {
      const c = await repo.create({
        src_lead_id: fixtures.leadIds.a,
        dst_lead_id: fixtures.leadIds.b,
        similarity_score: 0.7,
        reasons: [],
      });
      await repo.resolve(c.id, "approved", null);
      await expect(repo.resolve(c.id, "rejected", null)).rejects.toBeInstanceOf(ConflictError);
    });

    test("resolve inexistente lanza NotFoundError", async () => {
      await expect(repo.resolve("fake", "approved", null)).rejects.toBeInstanceOf(NotFoundError);
    });

    test("list filtra por status + orden DESC", async () => {
      const a = await repo.create({
        src_lead_id: fixtures.leadIds.one,
        dst_lead_id: fixtures.leadIds.two,
        similarity_score: 0.7,
        reasons: [],
      });
      await new Promise((r) => setTimeout(r, 5));
      const b = await repo.create({
        src_lead_id: fixtures.leadIds.three,
        dst_lead_id: fixtures.leadIds.four,
        similarity_score: 0.7,
        reasons: [],
      });
      await repo.resolve(a.id, "approved", null);

      const pending = await repo.list({ status: "pending" });
      expect(pending.map((r) => r.id)).toEqual([b.id]);

      const approved = await repo.list({ status: "approved" });
      expect(approved.map((r) => r.id)).toEqual([a.id]);
    });

    test("reasons deep-clone defense", async () => {
      const reasons = ["r1", "r2"];
      const c = await repo.create({
        src_lead_id: fixtures.leadIds.a,
        dst_lead_id: fixtures.leadIds.b,
        similarity_score: 0.5,
        reasons,
      });
      reasons.push("mutado");
      const refetch = await repo.findById(c.id);
      expect(refetch?.reasons).toEqual(["r1", "r2"]);
    });
  });
}
