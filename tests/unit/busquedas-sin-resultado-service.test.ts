import { describe, expect, test } from "vitest";
import {
  InMemoryBusquedasSinResultadoRepository,
  type LlamadaHerramienta,
} from "@/server/repositories/busquedas-sin-resultado.repo";
import { BusquedasSinResultadoService } from "@/server/services/catalog/busquedas-sin-resultado.service";

const AHORA = new Date("2026-10-01T12:00:00Z");
const llamada = (query: string, dias: number): LlamadaHerramienta => ({
  tool_name: "buscar_repuesto",
  args: { query },
  result: { matches: [], count: 0 },
  error: null,
  created_at: new Date(AHORA.getTime() - dias * 86_400_000),
});

describe("BusquedasSinResultadoService", () => {
  const repo = new InMemoryBusquedasSinResultadoRepository([
    llamada("reciente", 2),
    llamada("limite", 29),
    llamada("vieja", 45),
  ]);
  const service = new BusquedasSinResultadoService(repo, () => AHORA);

  test("por defecto mira los últimos 30 días", async () => {
    const filas = await service.listar();
    expect(filas.map((f) => f.busqueda).sort()).toEqual(["limite", "reciente"]);
  });

  test("acepta otra ventana en días", async () => {
    const filas = await service.listar({ dias: 7 });
    expect(filas.map((f) => f.busqueda)).toEqual(["reciente"]);
  });
});
