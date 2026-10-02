import { beforeEach, describe, expect, test } from "vitest";
import type { BusquedasSinResultadoRepository } from "@/server/repositories/busquedas-sin-resultado.repo";

/** Una llamada a `buscar_repuesto` tal como la dejó el agente en `tool_executions`. */
export interface LlamadaSembrada {
  toolName?: string;
  args: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error?: string | null;
  creadaEn: Date;
}

export interface BusquedasSinResultadoHarness {
  repo: BusquedasSinResultadoRepository;
  sembrar(llamadas: LlamadaSembrada[]): Promise<void>;
}

const VACIO = { matches: [], count: 0 };
const CON_HITS = { matches: [{ id: "x" }], count: 1 };
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);

// Contrato del reporte de búsquedas sin resultado. Lo corren el repo in-memory y el
// de Supabase contra Postgres real (la función SQL `busquedas_sin_resultado`).
export function runBusquedasSinResultadoContract(
  make: () => Promise<BusquedasSinResultadoHarness>,
) {
  describe("BusquedasSinResultadoRepository contract", () => {
    let h: BusquedasSinResultadoHarness;
    beforeEach(async () => {
      h = await make();
    });

    test("agrupa por texto plegado, marca, modelo y año y cuenta las veces", async () => {
      await h.sembrar([
        {
          args: { query: "  Radiador ", marca: "Chevrolet", modelo: "Aveo", anio: 2010 },
          result: VACIO,
          creadaEn: hace(3),
        },
        {
          args: { query: "radiador", marca: "chevrolet", modelo: "aveo", anio: 2010 },
          result: VACIO,
          creadaEn: hace(1),
        },
        { args: { query: "Pastilla Freno" }, result: VACIO, creadaEn: hace(2) },
      ]);
      const filas = await h.repo.listar(hace(30), 100);
      expect(filas).toHaveLength(2);
      expect(filas[0]).toMatchObject({
        busqueda: "radiador",
        marca: "chevrolet",
        modelo: "aveo",
        anio: 2010,
        veces: 2,
      });
      expect(Math.abs(filas[0]!.ultima_vez.getTime() - hace(1).getTime())).toBeLessThan(1000);
      expect(filas[1]).toMatchObject({
        busqueda: "pastilla freno",
        marca: null,
        modelo: null,
        anio: null,
        veces: 1,
      });
    });

    test("pliega tildes y mayúsculas", async () => {
      await h.sembrar([
        { args: { query: "Cañería" }, result: VACIO, creadaEn: hace(1) },
        { args: { query: "CANERIA" }, result: VACIO, creadaEn: hace(1) },
      ]);
      const filas = await h.repo.listar(hace(30), 100);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ busqueda: "caneria", veces: 2 });
    });

    test("ignora búsquedas con resultados, con error y de otras herramientas", async () => {
      await h.sembrar([
        { args: { query: "con hits" }, result: CON_HITS, creadaEn: hace(1) },
        { args: { query: "con error" }, result: VACIO, error: "boom", creadaEn: hace(1) },
        { args: { query: "otra tool" }, result: VACIO, toolName: "otra", creadaEn: hace(1) },
        { args: { query: "sin result" }, result: null, creadaEn: hace(1) },
        { args: { query: "sin hits" }, result: VACIO, creadaEn: hace(1) },
      ]);
      const filas = await h.repo.listar(hace(30), 100);
      expect(filas.map((f) => f.busqueda)).toEqual(["sin hits"]);
    });

    test("respeta la fecha desde", async () => {
      await h.sembrar([
        { args: { query: "vieja" }, result: VACIO, creadaEn: hace(40) },
        { args: { query: "nueva" }, result: VACIO, creadaEn: hace(2) },
      ]);
      expect((await h.repo.listar(hace(30), 100)).map((f) => f.busqueda)).toEqual(["nueva"]);
    });

    test("ordena por veces y aplica el límite", async () => {
      await h.sembrar([
        { args: { query: "a" }, result: VACIO, creadaEn: hace(1) },
        { args: { query: "b" }, result: VACIO, creadaEn: hace(1) },
        { args: { query: "b" }, result: VACIO, creadaEn: hace(1) },
        { args: { query: "c" }, result: VACIO, creadaEn: hace(1) },
        { args: { query: "c" }, result: VACIO, creadaEn: hace(1) },
        { args: { query: "c" }, result: VACIO, creadaEn: hace(1) },
      ]);
      const filas = await h.repo.listar(hace(30), 2);
      expect(filas.map((f) => [f.busqueda, f.veces])).toEqual([
        ["c", 3],
        ["b", 2],
      ]);
    });

    test("sin llamadas devuelve lista vacía", async () => {
      expect(await h.repo.listar(hace(30), 100)).toEqual([]);
    });
  });
}
