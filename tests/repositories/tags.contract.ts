import { describe, expect, test, beforeEach } from "vitest";
import type { TagInsert, TagsRepository } from "@/server/repositories/tags.repo";
import type { UUID } from "@/types/entities";

function baseTag(overrides: Partial<TagInsert> = {}): TagInsert {
  return {
    nombre: "prioridad-alta",
    color: "#f97316",
    descripcion: "Lead a contactar pronto",
    ...overrides,
  };
}

/**
 * Fixtures inyectables para que el contract corra contra impls con FKs reales
 * (Supabase) sin perder el caso InMemory (tolerante a strings literales).
 *
 * - InMemory: defaults strings (`"lead-1"`, `"user-A"`...). FKs no enforced.
 * - Supabase: integration test seedea leads + usuarios reales y pasa sus UUIDs.
 */
export interface TagsContractFixtures {
  leadIds: {
    L1: UUID;
    A: UUID;
    B: UUID;
    C: UUID;
    empty: UUID;
  };
  userIds: {
    A: UUID;
    B: UUID;
    X: UUID;
  };
  /** UUID arbitraria no asignada a ningún lead_tag (para test removeFromLead missing). */
  unknownTagId: UUID;
  /** UUID arbitraria de tag sin lead_tags (para test listLeadIdsByTag never-assigned). */
  unknownAssignedTagId: UUID;
}

const DEFAULT_FIXTURES: TagsContractFixtures = {
  leadIds: {
    L1: "lead-1",
    A: "lead-A",
    B: "lead-B",
    C: "lead-C",
    empty: "lead-empty",
  },
  userIds: {
    A: "user-A",
    B: "user-B",
    X: "user-X",
  },
  unknownTagId: "tag-X",
  unknownAssignedTagId: "never-assigned",
};

export type TagsContractFixturesArg = TagsContractFixtures | (() => TagsContractFixtures);

export function runTagsContract(
  makeRepo: () => TagsRepository,
  fixturesArg: TagsContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("TagsRepository contract", () => {
    let repo: TagsRepository;
    let fixtures: TagsContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
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

    test("delete borra el tag", async () => {
      const t = await repo.create(baseTag());
      await repo.delete(t.id);
      expect(await repo.findById(t.id)).toBeNull();
    });

    test("delete idempotente: no-op si el tag no existe", async () => {
      await expect(repo.delete(fixtures.unknownTagId)).resolves.toBeUndefined();
    });

    test("delete arrastra los lead_tags del tag (CASCADE)", async () => {
      const borrado = await repo.create(baseTag({ nombre: "borrado" }));
      const queda = await repo.create(baseTag({ nombre: "queda" }));
      await repo.assignToLead(fixtures.leadIds.A, borrado.id, "manual");
      await repo.assignToLead(fixtures.leadIds.B, borrado.id, "manual");
      await repo.assignToLead(fixtures.leadIds.A, queda.id, "manual");

      await repo.delete(borrado.id);

      expect(await repo.listLeadIdsByTag(borrado.id)).toEqual([]);
      // El resto de las asignaciones del mismo lead sobreviven.
      expect((await repo.listByLead(fixtures.leadIds.A)).map((t) => t.id)).toEqual([queda.id]);
      expect(await repo.listByLead(fixtures.leadIds.B)).toEqual([]);
    });

    // --- LeadTag ---

    test("assignToLead crea LeadTag con source + assigned_at", async () => {
      const t = await repo.create(baseTag());
      const lt = await repo.assignToLead(fixtures.leadIds.L1, t.id, "manual", fixtures.userIds.A);
      expect(lt.lead_id).toBe(fixtures.leadIds.L1);
      expect(lt.tag_id).toBe(t.id);
      expect(lt.source).toBe("manual");
      expect(lt.assigned_by).toBe(fixtures.userIds.A);
      expect(lt.assigned_at).toBeInstanceOf(Date);
    });

    test("assignToLead workflow sin assignedBy queda null", async () => {
      const t = await repo.create(baseTag());
      const lt = await repo.assignToLead(fixtures.leadIds.L1, t.id, "workflow");
      expect(lt.source).toBe("workflow");
      expect(lt.assigned_by).toBeNull();
    });

    test("assignToLead idempotente: no sobrescribe source/assigned_by/assigned_at", async () => {
      const t = await repo.create(baseTag());
      const first = await repo.assignToLead(fixtures.leadIds.L1, t.id, "workflow");
      await new Promise((r) => setTimeout(r, 5));
      const second = await repo.assignToLead(
        fixtures.leadIds.L1,
        t.id,
        "manual",
        fixtures.userIds.B,
      );
      expect(second.source).toBe(first.source);
      expect(second.assigned_by).toBe(first.assigned_by);
      expect(second.assigned_at.getTime()).toBe(first.assigned_at.getTime());

      const assigned = await repo.listByLead(fixtures.leadIds.L1);
      expect(assigned).toHaveLength(1);
    });

    test("removeFromLead saca la etiqueta del lead", async () => {
      const t = await repo.create(baseTag());
      await repo.assignToLead(fixtures.leadIds.L1, t.id, "manual");
      await repo.removeFromLead(fixtures.leadIds.L1, t.id);
      expect(await repo.listByLead(fixtures.leadIds.L1)).toEqual([]);
    });

    test("removeFromLead idempotente: no-op si no existe", async () => {
      await expect(
        repo.removeFromLead(fixtures.leadIds.L1, fixtures.unknownTagId),
      ).resolves.toBeUndefined();
    });

    // Sacar una etiqueta a mano tiene que servir de algo. La fila no se borra:
    // queda marcada, y esa marca es lo que impide que la regla que la colgó la
    // devuelva apenas el cliente repita la palabra que la disparó. Sin esto el
    // vendedor la sacaría en cada mensaje y sentiría que la app le pelea.
    describe("una etiqueta sacada a mano no vuelve sola", () => {
      test("un workflow NO revive la que sacó una persona", async () => {
        const t = await repo.create(baseTag());
        await repo.assignToLead(fixtures.leadIds.L1, t.id, "workflow");
        await repo.removeFromLead(fixtures.leadIds.L1, t.id, fixtures.userIds.A);

        await repo.assignToLead(fixtures.leadIds.L1, t.id, "workflow");

        expect(await repo.listByLead(fixtures.leadIds.L1)).toEqual([]);
      });

      test("una persona SÍ puede volver a ponerla", async () => {
        const t = await repo.create(baseTag());
        await repo.assignToLead(fixtures.leadIds.L1, t.id, "workflow");
        await repo.removeFromLead(fixtures.leadIds.L1, t.id, fixtures.userIds.A);

        await repo.assignToLead(fixtures.leadIds.L1, t.id, "manual", fixtures.userIds.B);

        const puestas = await repo.listByLead(fixtures.leadIds.L1);
        expect(puestas).toHaveLength(1);
        expect(puestas[0]?.source).toBe("manual");
        expect(puestas[0]?.assigned_by).toBe(fixtures.userIds.B);
      });

      test("la descartada no cuenta como uso ni aparece entre los leads del tag", async () => {
        const t = await repo.create(baseTag());
        await repo.assignToLead(fixtures.leadIds.L1, t.id, "manual");
        await repo.removeFromLead(fixtures.leadIds.L1, t.id);

        // Si contara, el modal mostraría "1 lead" y al hacer clic no habría
        // ninguno: el contador y la lista tienen que decir lo mismo.
        expect(await repo.listLeadIdsByTag(t.id)).toEqual([]);
        expect((await repo.countLeadsByTag()).get(t.id) ?? 0).toBe(0);
      });

      test("volver a sacarla no mueve la fecha del primer descarte", async () => {
        const t = await repo.create(baseTag());
        await repo.assignToLead(fixtures.leadIds.L1, t.id, "manual");
        await repo.removeFromLead(fixtures.leadIds.L1, t.id, fixtures.userIds.A);
        await repo.removeFromLead(fixtures.leadIds.L1, t.id, fixtures.userIds.B);

        expect(await repo.listByLead(fixtures.leadIds.L1)).toEqual([]);
      });
    });

    test("listByLead devuelve AssignedTag con join (Tag + metadata)", async () => {
      const t = await repo.create(baseTag({ nombre: "x", color: "#ffffff" }));
      await repo.assignToLead(fixtures.leadIds.L1, t.id, "manual", fixtures.userIds.X);

      const list = await repo.listByLead(fixtures.leadIds.L1);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(t.id);
      expect(list[0]?.nombre).toBe("x");
      expect(list[0]?.color).toBe("#ffffff");
      expect(list[0]?.source).toBe("manual");
      expect(list[0]?.assigned_by).toBe(fixtures.userIds.X);
      expect(list[0]?.assigned_at).toBeInstanceOf(Date);
    });

    test("listByLead devuelve [] cuando lead no tiene tags", async () => {
      expect(await repo.listByLead(fixtures.leadIds.empty)).toEqual([]);
    });

    test("listLeadIdsByTag devuelve leads con ese tag", async () => {
      const t1 = await repo.create(baseTag({ nombre: "t1" }));
      const t2 = await repo.create(baseTag({ nombre: "t2" }));
      await repo.assignToLead(fixtures.leadIds.A, t1.id, "manual");
      await repo.assignToLead(fixtures.leadIds.B, t1.id, "workflow");
      await repo.assignToLead(fixtures.leadIds.C, t2.id, "manual");

      const ids = (await repo.listLeadIdsByTag(t1.id)).sort();
      expect(ids).toEqual([fixtures.leadIds.A, fixtures.leadIds.B].sort());
    });

    test("listLeadIdsByTag devuelve [] cuando tag no asignado", async () => {
      expect(await repo.listLeadIdsByTag(fixtures.unknownAssignedTagId)).toEqual([]);
    });

    test("countLeadsByTag cuenta los leads de cada tag en una sola pasada", async () => {
      const t1 = await repo.create(baseTag({ nombre: "t1" }));
      const t2 = await repo.create(baseTag({ nombre: "t2" }));
      await repo.assignToLead(fixtures.leadIds.A, t1.id, "manual");
      await repo.assignToLead(fixtures.leadIds.B, t1.id, "workflow");
      await repo.assignToLead(fixtures.leadIds.C, t2.id, "manual");

      const conteo = await repo.countLeadsByTag();

      expect(conteo.get(t1.id)).toBe(2);
      expect(conteo.get(t2.id)).toBe(1);
    });

    test("countLeadsByTag omite los tags sin uso — el consumidor asume 0", async () => {
      const sinUso = await repo.create(baseTag({ nombre: "sin-uso" }));
      expect((await repo.countLeadsByTag()).has(sinUso.id)).toBe(false);
    });

    test("countLeadsByTag no cuenta dos veces al mismo lead en el mismo tag", async () => {
      const t = await repo.create(baseTag());
      await repo.assignToLead(fixtures.leadIds.A, t.id, "manual");
      // assignToLead es idempotente: la PK (lead_id, tag_id) impide la segunda fila.
      await repo.assignToLead(fixtures.leadIds.A, t.id, "manual");

      expect((await repo.countLeadsByTag()).get(t.id)).toBe(1);
    });
  });
}
