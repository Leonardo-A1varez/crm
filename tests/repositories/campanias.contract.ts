import { describe, expect, it } from "vitest";
import type { CampaniasRepository } from "@/server/repositories/campanias.repo";

export function runCampaniasContract(makeRepo: () => CampaniasRepository) {
  describe("CampaniasRepository", () => {
    it("crea y lista", async () => {
      const repo = makeRepo();
      await repo.create({
        nombre: "Lanzamiento verano",
        desde: new Date("2026-01-01"),
        hasta: new Date("2026-01-31"),
      });
      const campanias = await repo.list();
      expect(campanias).toHaveLength(1);
      expect(campanias[0]?.nombre).toBe("Lanzamiento verano");
    });

    it("edita una existente", async () => {
      const repo = makeRepo();
      const creada = await repo.create({
        nombre: "Original",
        desde: new Date("2026-01-01"),
        hasta: new Date("2026-01-31"),
      });
      const editada = await repo.update(creada.id, { nombre: "Renombrada" });
      expect(editada.nombre).toBe("Renombrada");
    });

    it("update de una inexistente lanza NotFoundError", async () => {
      const repo = makeRepo();
      await expect(repo.update(crypto.randomUUID(), { nombre: "x" })).rejects.toThrow();
    });

    it("delete es idempotente", async () => {
      const repo = makeRepo();
      await expect(repo.delete(crypto.randomUUID())).resolves.toBeUndefined();
    });
  });
}
