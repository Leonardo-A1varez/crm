import { beforeEach, describe, expect, test } from "vitest";
import type { MetricsRepository } from "@/server/repositories/metrics.repo";

/**
 * Contrato del read-model de métricas.
 *
 * No verifica campo por campo de las once formas de fila: verifica **el corte
 * por fecha**, que es lo único que comparten todos los `listXDesde` y lo único
 * cuyo error no se ve. Un corte roto no rompe la pantalla: la llena con datos
 * de más o la deja vacía, y el tablero miente sin que falle nada.
 *
 * Los datos los siembra cada harness, porque la impl in-memory y la de Supabase
 * no comparten forma de cargarlos. El contrato solo pregunta.
 */
export interface MetricsContractFixtures {
  /** Una fecha anterior a todo lo sembrado. */
  antesDeTodo: Date;
  /** Una fecha posterior a todo lo sembrado. */
  despuesDeTodo: Date;
}

export type MetricsContractFixturesArg = MetricsContractFixtures | (() => MetricsContractFixtures);

export function runMetricsContract(
  makeRepo: () => MetricsRepository,
  fixturesArg: MetricsContractFixturesArg,
) {
  describe("MetricsRepository contract", () => {
    let repo: MetricsRepository;
    let fixtures: MetricsContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    // Cada método por separado y no en un bucle: si uno se rompe, el nombre del
    // test tiene que decir cuál.
    const cortes = [
      ["listSesionesDesde", (r: MetricsRepository, d: Date) => r.listSesionesDesde(d)],
      ["listMensajesDesde", (r: MetricsRepository, d: Date) => r.listMensajesDesde(d)],
      ["listLeadsDesde", (r: MetricsRepository, d: Date) => r.listLeadsDesde(d)],
      ["listRuleExecutionsDesde", (r: MetricsRepository, d: Date) => r.listRuleExecutionsDesde(d)],
      [
        "listTurnClassificationsDesde",
        (r: MetricsRepository, d: Date) => r.listTurnClassificationsDesde(d),
      ],
      ["listToolExecutionsDesde", (r: MetricsRepository, d: Date) => r.listToolExecutionsDesde(d)],
      ["listLlmUsageDesde", (r: MetricsRepository, d: Date) => r.listLlmUsageDesde(d)],
      ["listHandoffsDesde", (r: MetricsRepository, d: Date) => r.listHandoffsDesde(d)],
    ] as const;

    for (const [nombre, llamar] of cortes) {
      test(`${nombre} no devuelve nada de después del corte`, async () => {
        expect(await llamar(repo, fixtures.despuesDeTodo)).toEqual([]);
      });
    }

    test("listSesionesDesde devuelve lo sembrado cuando el corte es anterior", async () => {
      const filas = await repo.listSesionesDesde(fixtures.antesDeTodo);

      expect(filas.length).toBeGreaterThan(0);
      expect(filas[0]?.started_at).toBeInstanceOf(Date);
    });

    test("listLeadsDesde devuelve lo sembrado cuando el corte es anterior", async () => {
      expect((await repo.listLeadsDesde(fixtures.antesDeTodo)).length).toBeGreaterThan(0);
    });

    test("listMensajesDesde devuelve lo sembrado cuando el corte es anterior", async () => {
      expect((await repo.listMensajesDesde(fixtures.antesDeTodo)).length).toBeGreaterThan(0);
    });

    // Los catálogos no se cortan por fecha: son el estado actual, no un flujo.
    test("los catálogos responden sin corte de fecha", async () => {
      await expect(repo.listIntentsActivos()).resolves.toBeInstanceOf(Array);
      await expect(repo.listReglasActivas()).resolves.toBeInstanceOf(Array);
      await expect(repo.listUsuarios()).resolves.toBeInstanceOf(Array);
      await expect(repo.listCampanias()).resolves.toBeInstanceOf(Array);
    });
  });
}
