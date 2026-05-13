import { describe, expect, test, beforeEach } from "vitest";
import type { IntentInsert, IntentsRepository } from "@/server/repositories/intents.repo";

function baseInsert(overrides: Partial<IntentInsert> = {}): IntentInsert {
  return {
    nombre: "consulta_precio",
    descripcion: "Lead pregunta precio de repuesto",
    ejemplos: ["cuánto sale", "qué precio tiene"],
    auto_detectado: true,
    activo: true,
    ...overrides,
  };
}

export function runIntentsContract(makeRepo: () => IntentsRepository) {
  describe("IntentsRepository contract", () => {
    let repo: IntentsRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    test("create asigna id + persiste con ejemplos", async () => {
      const i = await repo.create(baseInsert());
      expect(i.id).toBeTypeOf("string");
      expect(i.nombre).toBe("consulta_precio");
      expect(i.ejemplos).toEqual(["cuánto sale", "qué precio tiene"]);
      expect(await repo.findById(i.id)).toEqual(i);
    });

    test("findById null cuando id falta", async () => {
      expect(await repo.findById("missing")).toBeNull();
    });

    test("findByNombre devuelve primer match", async () => {
      const i = await repo.create(baseInsert());
      const found = await repo.findByNombre("consulta_precio");
      expect(found?.id).toBe(i.id);
      expect(await repo.findByNombre("nope")).toBeNull();
    });

    test("update aplica patch + permite renombrar", async () => {
      const i = await repo.create(baseInsert());
      const patched = await repo.update(i.id, {
        nombre: "consulta_precio_v2",
        activo: false,
      });
      expect(patched.nombre).toBe("consulta_precio_v2");
      expect(patched.activo).toBe(false);
      expect(patched.id).toBe(i.id);
    });

    test("update throws cuando id falta", async () => {
      await expect(repo.update("missing", { activo: false })).rejects.toThrow();
    });

    test("list devuelve todos sin filter", async () => {
      await repo.create(baseInsert());
      await repo.create(baseInsert({ nombre: "saludo" }));
      const all = await repo.list();
      expect(all).toHaveLength(2);
    });

    test("list filtra por activo", async () => {
      await repo.create(baseInsert({ nombre: "a", activo: true }));
      await repo.create(baseInsert({ nombre: "b", activo: false }));
      await repo.create(baseInsert({ nombre: "c", activo: true }));

      const activos = await repo.list({ activo: true });
      expect(activos).toHaveLength(2);
      expect(activos.every((i) => i.activo)).toBe(true);

      const inactivos = await repo.list({ activo: false });
      expect(inactivos).toHaveLength(1);
    });

    test("update muta ejemplos sin afectar storage por referencia externa", async () => {
      const i = await repo.create(baseInsert());
      // Mutar el array retornado no debe afectar storage.
      i.ejemplos.push("mutación externa");
      const refetch = await repo.findById(i.id);
      expect(refetch?.ejemplos).toEqual(["cuánto sale", "qué precio tiene"]);
    });
  });
}
