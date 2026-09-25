import { describe, expect, test } from "vitest";
import { IllegalStateError } from "@/lib/errors";
import { InMemoryEmpresasRepository, type Empresa } from "@/server/repositories/empresas.repo";
import { DefaultEmpresaService } from "@/server/services/empresa/empresa.service";

/** Fixture sintético: no es la empresa de ninguna instalación. */
const EMPRESA: Empresa = {
  id: "00000000-0000-4000-8000-000000000001",
  nombre: "Repuestos de Prueba",
  ruc_nit: "0000000000001",
  created_at: new Date("2026-05-12T00:00:00Z"),
};

describe("DefaultEmpresaService", () => {
  test("sin fila en empresas devuelve null en vez de inventar una empresa", async () => {
    const svc = new DefaultEmpresaService({ empresas: new InMemoryEmpresasRepository() });

    expect(await svc.obtener()).toBeNull();
  });

  test("con una fila, devuelve esa", async () => {
    const svc = new DefaultEmpresaService({
      empresas: new InMemoryEmpresasRepository([EMPRESA]),
    });

    expect(await svc.obtener()).toEqual(EMPRESA);
  });

  test("con más de una fila falla: la instalación es de una sola empresa", async () => {
    const otra: Empresa = { ...EMPRESA, id: "00000000-0000-4000-8000-000000000002" };
    const svc = new DefaultEmpresaService({
      empresas: new InMemoryEmpresasRepository([EMPRESA, otra]),
    });

    await expect(svc.obtener()).rejects.toBeInstanceOf(IllegalStateError);
  });

  test("lo que devuelve es una copia: tocarla no cambia el repositorio", async () => {
    const svc = new DefaultEmpresaService({
      empresas: new InMemoryEmpresasRepository([EMPRESA]),
    });

    const primera = await svc.obtener();
    if (primera) primera.nombre = "otro nombre";

    expect((await svc.obtener())?.nombre).toBe("Repuestos de Prueba");
  });
});
