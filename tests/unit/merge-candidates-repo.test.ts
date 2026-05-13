import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { ConflictError, NotFoundError } from "@/lib/errors";

describe("InMemoryMergeCandidatesRepository", () => {
  let repo: InMemoryMergeCandidatesRepository;

  beforeEach(() => {
    repo = new InMemoryMergeCandidatesRepository();
  });

  test("create asigna id + status pending por default", async () => {
    const c = await repo.create({
      src_lead_id: "a",
      dst_lead_id: "b",
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
        src_lead_id: "x",
        dst_lead_id: "x",
        similarity_score: 1,
        reasons: [],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("create duplicate pending lanza ConflictError (orden-independiente)", async () => {
    await repo.create({
      src_lead_id: "a",
      dst_lead_id: "b",
      similarity_score: 0.7,
      reasons: [],
    });
    await expect(
      repo.create({
        src_lead_id: "b",
        dst_lead_id: "a",
        similarity_score: 0.8,
        reasons: [],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("findPendingPair orden-independiente", async () => {
    const c = await repo.create({
      src_lead_id: "a",
      dst_lead_id: "b",
      similarity_score: 0.7,
      reasons: [],
    });
    expect((await repo.findPendingPair("a", "b"))?.id).toBe(c.id);
    expect((await repo.findPendingPair("b", "a"))?.id).toBe(c.id);
  });

  test("findPendingPair ignora resueltos", async () => {
    const c = await repo.create({
      src_lead_id: "a",
      dst_lead_id: "b",
      similarity_score: 0.7,
      reasons: [],
    });
    await repo.resolve(c.id, "approved", "user-1");
    expect(await repo.findPendingPair("a", "b")).toBeNull();
  });

  test("findAnyPair incluye resueltos", async () => {
    const c = await repo.create({
      src_lead_id: "a",
      dst_lead_id: "b",
      similarity_score: 0.7,
      reasons: [],
    });
    await repo.resolve(c.id, "rejected", "user-1");
    expect((await repo.findAnyPair("a", "b"))?.id).toBe(c.id);
  });

  test("resolve setea status + resolved_by + resolved_at", async () => {
    const c = await repo.create({
      src_lead_id: "a",
      dst_lead_id: "b",
      similarity_score: 0.7,
      reasons: [],
    });
    const r = await repo.resolve(c.id, "approved", "user-1");
    expect(r.status).toBe("approved");
    expect(r.resolved_by).toBe("user-1");
    expect(r.resolved_at).toBeInstanceOf(Date);
  });

  test("resolve sobre ya resuelto lanza ConflictError", async () => {
    const c = await repo.create({
      src_lead_id: "a",
      dst_lead_id: "b",
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
      src_lead_id: "1",
      dst_lead_id: "2",
      similarity_score: 0.7,
      reasons: [],
    });
    await new Promise((r) => setTimeout(r, 5));
    const b = await repo.create({
      src_lead_id: "3",
      dst_lead_id: "4",
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
      src_lead_id: "a",
      dst_lead_id: "b",
      similarity_score: 0.5,
      reasons,
    });
    reasons.push("mutado");
    const refetch = await repo.findById(c.id);
    expect(refetch!.reasons).toEqual(["r1", "r2"]);
  });
});
