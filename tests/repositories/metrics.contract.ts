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
      ["listSesionesDesde", (r: MetricsRepository, d: Date, h: Date) => r.listSesionesDesde(d, h)],
      ["listMensajesDesde", (r: MetricsRepository, d: Date, h: Date) => r.listMensajesDesde(d, h)],
      ["listLeadsDesde", (r: MetricsRepository, d: Date, h: Date) => r.listLeadsDesde(d, h)],
      [
        "listRuleExecutionsDesde",
        (r: MetricsRepository, d: Date, h: Date) => r.listRuleExecutionsDesde(d, h),
      ],
      [
        "listTurnClassificationsDesde",
        (r: MetricsRepository, d: Date, h: Date) => r.listTurnClassificationsDesde(d, h),
      ],
      [
        "listToolExecutionsDesde",
        (r: MetricsRepository, d: Date, h: Date) => r.listToolExecutionsDesde(d, h),
      ],
      ["listLlmUsageDesde", (r: MetricsRepository, d: Date, h: Date) => r.listLlmUsageDesde(d, h)],
      ["listHandoffsDesde", (r: MetricsRepository, d: Date, h: Date) => r.listHandoffsDesde(d, h)],
    ] as const;

    for (const [nombre, llamar] of cortes) {
      test(`${nombre} no devuelve nada de después del corte`, async () => {
        expect(await llamar(repo, fixtures.despuesDeTodo, fixtures.despuesDeTodo)).toEqual([]);
      });
    }

    // `desde = antesDeTodo` por sí solo incluiría todo lo sembrado; con
    // `hasta = antesDeTodo` también, la cota superior tiene que vaciarlo. Si
    // `hasta` no se aplicara (el bug que este task cierra), esto devolvería
    // filas y el test fallaría — no es una tautología.
    for (const [nombre, llamar] of cortes) {
      test(`${nombre} no devuelve nada cuando hasta es anterior a lo sembrado`, async () => {
        expect(await llamar(repo, fixtures.antesDeTodo, fixtures.antesDeTodo)).toEqual([]);
      });
    }

    test("listSesionesDesde devuelve lo sembrado cuando el corte es anterior", async () => {
      const filas = await repo.listSesionesDesde(fixtures.antesDeTodo, fixtures.despuesDeTodo);

      expect(filas.length).toBeGreaterThan(0);
      expect(filas[0]?.started_at).toBeInstanceOf(Date);
    });

    test("listLeadsDesde devuelve lo sembrado cuando el corte es anterior", async () => {
      expect(
        (await repo.listLeadsDesde(fixtures.antesDeTodo, fixtures.despuesDeTodo)).length,
      ).toBeGreaterThan(0);
    });

    test("listMensajesDesde devuelve lo sembrado cuando el corte es anterior", async () => {
      expect(
        (await repo.listMensajesDesde(fixtures.antesDeTodo, fixtures.despuesDeTodo)).length,
      ).toBeGreaterThan(0);
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
