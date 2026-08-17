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
  /**
   * El `started_at` EXACTO de una sesión sembrada — no una fecha cualquiera del
   * medio. Es lo único con lo que se puede distinguir `< hasta` de `<= hasta`:
   * las ventanas de ancho cero (`desde === hasta`) que usa el resto del contrato
   * salen vacías con las dos comparaciones, así que un `.lt()` que alguien
   * cambie por `.lte()` las seguiría pasando todas.
   */
  justoEnUnaFila: Date;
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

    /**
     * `hasta` es EXCLUSIVO: la fila que cae justo en ese instante queda afuera.
     *
     * Solo sobre `listSesionesDesde` y no sobre los 8 cortes: el único
     * timestamp que los harnesses pueden garantizar exacto es el de la sesión
     * sembrada (en Supabase lo fecha la base con su `DEFAULT` y hay que leerlo
     * de vuelta). Los 8 métodos comparten literalmente la misma forma —`.gte()`
     * + `.lt()` sobre una columna de fecha—, así que pinchar uno pincha el
     * patrón; el resto del contrato ya cubre que cada cual aplique sus dos
     * cotas. Las dos aserciones van juntas a propósito: sin la segunda el test
     * pasaría también con un fixture que no cae sobre ninguna fila.
     */
    test("listSesionesDesde excluye la fila que cae justo en hasta", async () => {
      const enElBorde = (filas: { started_at: Date }[]) =>
        filas.some((f) => f.started_at.getTime() === fixtures.justoEnUnaFila.getTime());

      expect(
        enElBorde(await repo.listSesionesDesde(fixtures.antesDeTodo, fixtures.despuesDeTodo)),
      ).toBe(true);
      expect(
        enElBorde(await repo.listSesionesDesde(fixtures.antesDeTodo, fixtures.justoEnUnaFila)),
      ).toBe(false);
    });

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
    });
  });
}
