import { describe, expect, test, beforeEach } from "vitest";
import type { TagInsert, TagsRepository } from "@/server/repositories/tags.repo";

function baseTag(overrides: Partial<TagInsert> = {}): TagInsert {
  return {
    nombre: "prioridad-alta",
    color: "#f97316",
    descripcion: "Lead a contactar pronto",
    ...overrides,
  };
}

export function runTagsContract(makeRepo: () => TagsRepository) {
  describe("TagsRepository contract", () => {
    let repo: TagsRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    // --- Tag CRUD ---

    test("create asigna id + persiste", async () => {
      const t = await repo.create(baseTag());
      expect(t.id).toBeTypeOf("string");
      expect(t.nombre).toBe("prioridad-alta");
      expect(await repo.findById(t.id)).toEqual(t);
    });

    test("findByNombre devuelve primer match", async () => {
      const t = await repo.create(baseTag());
      const found = await repo.findByNombre("prioridad-alta");
      expect(found?.id).toBe(t.id);
      expect(await repo.findByNombre("missing")).toBeNull();
    });

    test("update aplica patch", async () => {
      const t = await repo.create(baseTag());
      const patched = await repo.update(t.id, { color: "#000000" });
      expect(patched.color).toBe("#000000");
      expect(patched.id).toBe(t.id);
    });

    test("update throws cuando id falta", async () => {
      await expect(repo.update("missing", { color: "#fff" })).rejects.toThrow();
    });

    test("list devuelve todos los tags", async () => {
      await repo.create(baseTag({ nombre: "a" }));
      await repo.create(baseTag({ nombre: "b" }));
      const all = await repo.list();
      expect(all).toHaveLength(2);
    });

    // --- LeadTag ---

    test("assignToLead crea LeadTag con source + assigned_at", async () => {
      const t = await repo.create(baseTag());
      const lt = await repo.assignToLead("lead-1", t.id, "manual", "user-A");
      expect(lt.lead_id).toBe("lead-1");
      expect(lt.tag_id).toBe(t.id);
      expect(lt.source).toBe("manual");
      expect(lt.assigned_by).toBe("user-A");
      expect(lt.assigned_at).toBeInstanceOf(Date);
    });

    test("assignToLead workflow sin assignedBy queda null", async () => {
      const t = await repo.create(baseTag());
      const lt = await repo.assignToLead("lead-1", t.id, "workflow");
      expect(lt.source).toBe("workflow");
      expect(lt.assigned_by).toBeNull();
    });

    test("assignToLead idempotente: no sobrescribe source/assigned_by/assigned_at", async () => {
      const t = await repo.create(baseTag());
      const first = await repo.assignToLead("lead-1", t.id, "workflow");
      await new Promise((r) => setTimeout(r, 5));
      const second = await repo.assignToLead("lead-1", t.id, "manual", "user-B");
      expect(second.source).toBe(first.source);
      expect(second.assigned_by).toBe(first.assigned_by);
      expect(second.assigned_at.getTime()).toBe(first.assigned_at.getTime());

      const assigned = await repo.listByLead("lead-1");
      expect(assigned).toHaveLength(1);
    });

    test("removeFromLead elimina LeadTag", async () => {
      const t = await repo.create(baseTag());
      await repo.assignToLead("lead-1", t.id, "manual");
      await repo.removeFromLead("lead-1", t.id);
      expect(await repo.listByLead("lead-1")).toEqual([]);
    });

    test("removeFromLead idempotente: no-op si no existe", async () => {
      await expect(repo.removeFromLead("lead-1", "tag-X")).resolves.toBeUndefined();
    });

    test("listByLead devuelve AssignedTag con join (Tag + metadata)", async () => {
      const t = await repo.create(baseTag({ nombre: "x", color: "#fff" }));
      await repo.assignToLead("lead-1", t.id, "manual", "user-X");

      const list = await repo.listByLead("lead-1");
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(t.id);
      expect(list[0].nombre).toBe("x");
      expect(list[0].color).toBe("#fff");
      expect(list[0].source).toBe("manual");
      expect(list[0].assigned_by).toBe("user-X");
      expect(list[0].assigned_at).toBeInstanceOf(Date);
    });

    test("listByLead devuelve [] cuando lead no tiene tags", async () => {
      expect(await repo.listByLead("lead-empty")).toEqual([]);
    });

    test("listLeadIdsByTag devuelve leads con ese tag", async () => {
      const t1 = await repo.create(baseTag({ nombre: "t1" }));
      const t2 = await repo.create(baseTag({ nombre: "t2" }));
      await repo.assignToLead("lead-A", t1.id, "manual");
      await repo.assignToLead("lead-B", t1.id, "workflow");
      await repo.assignToLead("lead-C", t2.id, "manual");

      const ids = (await repo.listLeadIdsByTag(t1.id)).sort();
      expect(ids).toEqual(["lead-A", "lead-B"]);
    });

    test("listLeadIdsByTag devuelve [] cuando tag no asignado", async () => {
      expect(await repo.listLeadIdsByTag("never-assigned")).toEqual([]);
    });
  });
}
