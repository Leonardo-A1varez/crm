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
});
