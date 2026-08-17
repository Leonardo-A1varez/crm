import { describe, expect, it } from "vitest";
import { InMemoryCampaniasRepository } from "@/server/repositories/campanias.repo";
import { DefaultCampaniasAdminService } from "@/server/services/campanias/campanias-admin.service";
import { ValidationError } from "@/lib/errors";

function build() {
  const repo = new InMemoryCampaniasRepository();
  const service = new DefaultCampaniasAdminService({ campanias: repo });
  return { repo, service };
}

describe("DefaultCampaniasAdminService", () => {
  it("crea una campaña válida", async () => {
    const { service } = build();
    const c = await service.crear({
      nombre: "Lanzamiento verano",
      desde: new Date("2026-01-01"),
      hasta: new Date("2026-01-31"),
    });
    expect(c.nombre).toBe("Lanzamiento verano");
  });

  it("rechaza hasta <= desde", async () => {
    const { service } = build();
    await expect(
      service.crear({
        nombre: "Rango invertido",
        desde: new Date("2026-01-31"),
        hasta: new Date("2026-01-01"),
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("lista ordenadas de la más nueva a la más vieja por desde", async () => {
    const { service } = build();
    await service.crear({
      nombre: "A",
      desde: new Date("2026-01-01"),
      hasta: new Date("2026-01-31"),
    });
    await service.crear({
      nombre: "B",
      desde: new Date("2026-02-01"),
      hasta: new Date("2026-02-28"),
    });
    const listadas = await service.listar();
    expect(listadas.map((c) => c.nombre)).toEqual(["B", "A"]);
  });

  describe("editar()", () => {
    it("edita ambas fechas con rango válido", async () => {
      const { service } = build();
      const original = await service.crear({
        nombre: "Campaña original",
        desde: new Date("2026-01-01"),
        hasta: new Date("2026-01-31"),
      });
      const editada = await service.editar(original.id, {
        desde: new Date("2026-02-01"),
        hasta: new Date("2026-02-28"),
      });
      expect(editada.desde).toEqual(new Date("2026-02-01"));
      expect(editada.hasta).toEqual(new Date("2026-02-28"));
    });

    it("rechaza edición con ambas fechas cuando rango es inválido", async () => {
      const { service } = build();
      const original = await service.crear({
        nombre: "Campaña",
        desde: new Date("2026-01-01"),
        hasta: new Date("2026-01-31"),
      });
      await expect(
        service.editar(original.id, {
          desde: new Date("2026-02-28"),
          hasta: new Date("2026-02-01"),
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("edita solo desde cuando es válido contra hasta almacenado", async () => {
      const { service } = build();
      const original = await service.crear({
        nombre: "Campaña",
        desde: new Date("2026-01-01"),
        hasta: new Date("2026-01-31"),
      });
      const editada = await service.editar(original.id, {
        desde: new Date("2026-01-15"),
      });
      expect(editada.desde).toEqual(new Date("2026-01-15"));
      expect(editada.hasta).toEqual(original.hasta);
    });

    it("rechaza edición de solo desde cuando sería >= hasta almacenado", async () => {
      const { service } = build();
      const original = await service.crear({
        nombre: "Campaña",
        desde: new Date("2026-01-01"),
        hasta: new Date("2026-01-31"),
      });
      await expect(
        service.editar(original.id, {
          desde: new Date("2026-01-31"),
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("edita solo hasta cuando es válido contra desde almacenado", async () => {
      const { service } = build();
      const original = await service.crear({
        nombre: "Campaña",
        desde: new Date("2026-01-01"),
        hasta: new Date("2026-01-31"),
      });
      const editada = await service.editar(original.id, {
        hasta: new Date("2026-02-15"),
      });
      expect(editada.hasta).toEqual(new Date("2026-02-15"));
      expect(editada.desde).toEqual(original.desde);
    });

    it("rechaza edición de solo hasta cuando sería <= desde almacenado", async () => {
      const { service } = build();
      const original = await service.crear({
        nombre: "Campaña",
        desde: new Date("2026-01-01"),
        hasta: new Date("2026-01-31"),
      });
      await expect(
        service.editar(original.id, {
          hasta: new Date("2026-01-01"),
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("lanza error cuando se intenta editar campaña inexistente con campo de fecha", async () => {
      const { service } = build();
      const fakeId = "00000000-0000-0000-0000-000000000000" as const;
      await expect(
        service.editar(fakeId, {
          desde: new Date("2026-02-01"),
        }),
      ).rejects.toThrow(ValidationError);
    });
  });
});
