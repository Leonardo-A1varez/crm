import { describe, expect, test, beforeEach } from "vitest";
import type { ReglaInsert, RulesRepository } from "@/server/repositories/rules.repo";

function baseInsert(overrides: Partial<ReglaInsert> = {}): ReglaInsert {
  return {
    intent_id: "intent-1",
    condiciones_extra: null,
    respuesta_tipo: "text",
    respuesta_contenido: "Hola, gracias por escribir.",
    prioridad: 100,
    activa: true,
    ...overrides,
  };
}

export function runRulesContract(makeRepo: () => RulesRepository) {
  describe("RulesRepository contract", () => {
    let repo: RulesRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    test("create asigna id + created_at + persiste", async () => {
      const r = await repo.create(baseInsert());
      expect(r.id).toBeTypeOf("string");
      expect(r.created_at).toBeInstanceOf(Date);
      expect(r.intent_id).toBe("intent-1");
      expect(await repo.findById(r.id)).toEqual(r);
    });

    test("findById null cuando id falta", async () => {
      expect(await repo.findById("missing")).toBeNull();
    });

    test("update aplica patch pero bloquea cambio de intent_id", async () => {
      const r = await repo.create(baseInsert());
      const patched = await repo.update(r.id, {
        prioridad: 200,
        activa: false,
        respuesta_contenido: "Modificado",
      });
      expect(patched.prioridad).toBe(200);
      expect(patched.activa).toBe(false);
      expect(patched.respuesta_contenido).toBe("Modificado");
      expect(patched.intent_id).toBe(r.intent_id);
      expect(patched.created_at).toEqual(r.created_at);
    });

    test("update throws cuando id falta", async () => {
      await expect(repo.update("missing", { prioridad: 1 })).rejects.toThrow();
    });

    test("listActiveByIntent solo retorna activa=true del intent", async () => {
      await repo.create(baseInsert({ intent_id: "intent-A", activa: true }));
      await repo.create(baseInsert({ intent_id: "intent-A", activa: false }));
      await repo.create(baseInsert({ intent_id: "intent-B", activa: true }));

      const r = await repo.listActiveByIntent("intent-A");
      expect(r).toHaveLength(1);
      expect(r[0].intent_id).toBe("intent-A");
      expect(r[0].activa).toBe(true);
    });

    test("listActiveByIntent orden prioridad DESC", async () => {
      const low = await repo.create(baseInsert({ intent_id: "I", prioridad: 10 }));
      const high = await repo.create(baseInsert({ intent_id: "I", prioridad: 100 }));
      const mid = await repo.create(baseInsert({ intent_id: "I", prioridad: 50 }));

      const r = await repo.listActiveByIntent("I");
      expect(r.map((x) => x.id)).toEqual([high.id, mid.id, low.id]);
    });

    test("listActiveByIntent tie-break created_at ASC con misma prioridad", async () => {
      const first = await repo.create(baseInsert({ intent_id: "T", prioridad: 50 }));
      await new Promise((res) => setTimeout(res, 5));
      const second = await repo.create(baseInsert({ intent_id: "T", prioridad: 50 }));

      const r = await repo.listActiveByIntent("T");
      expect(r.map((x) => x.id)).toEqual([first.id, second.id]);
    });

    test("listActiveByIntent devuelve [] cuando no hay reglas", async () => {
      expect(await repo.listActiveByIntent("empty")).toEqual([]);
    });

    test("list sin filter devuelve todas", async () => {
      await repo.create(baseInsert({ intent_id: "X" }));
      await repo.create(baseInsert({ intent_id: "Y", activa: false }));
      const all = await repo.list();
      expect(all).toHaveLength(2);
    });

    test("list filtra por intentId", async () => {
      await repo.create(baseInsert({ intent_id: "X" }));
      await repo.create(baseInsert({ intent_id: "Y" }));
      await repo.create(baseInsert({ intent_id: "X", activa: false }));
      const r = await repo.list({ intentId: "X" });
      expect(r).toHaveLength(2);
      expect(r.every((x) => x.intent_id === "X")).toBe(true);
    });

    test("list filtra por activa", async () => {
      await repo.create(baseInsert({ activa: true }));
      await repo.create(baseInsert({ intent_id: "Z", activa: false }));
      const activos = await repo.list({ activa: true });
      expect(activos).toHaveLength(1);
      const inactivos = await repo.list({ activa: false });
      expect(inactivos).toHaveLength(1);
    });

    test("condiciones_extra jsonb se clona defensivamente", async () => {
      const cond: Record<string, unknown> = { urgencia: "alta", nested: { key: "val" } };
      const r = await repo.create(baseInsert({ condiciones_extra: cond }));
      // Mutación del input no afecta storage.
      (cond as { urgencia: string }).urgencia = "mutado";
      const refetch = await repo.findById(r.id);
      expect((refetch?.condiciones_extra as { urgencia: string }).urgencia).toBe("alta");
    });
  });
}
