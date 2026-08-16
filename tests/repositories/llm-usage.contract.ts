import { beforeEach, describe, expect, test } from "vitest";
import type { LlmUsageInsert, LlmUsageRepository } from "@/server/repositories/llm-usage.repo";
import type { UUID } from "@/types/entities";

export interface LlmUsageContractFixtures {
  leadSessionIds: { s1: UUID; s2: UUID };
  mensajeIds: { m1: UUID; m2: UUID };
}

const DEFAULT_FIXTURES: LlmUsageContractFixtures = {
  leadSessionIds: { s1: "sess-1", s2: "sess-2" },
  mensajeIds: { m1: "msg-1", m2: "msg-2" },
};

export type LlmUsageContractFixturesArg =
  | LlmUsageContractFixtures
  | (() => LlmUsageContractFixtures);

function base(
  fixtures: LlmUsageContractFixtures,
  overrides: Partial<LlmUsageInsert> = {},
): LlmUsageInsert {
  return {
    lead_session_id: fixtures.leadSessionIds.s1,
    mensaje_id: fixtures.mensajeIds.m1,
    modelo: "gpt-4o-mini",
    input_tokens: 1200,
    output_tokens: 300,
    costo_usd: 0.00036,
    workflow: "ai-agent",
    ...overrides,
  };
}

export function runLlmUsageContract(
  makeRepo: () => LlmUsageRepository,
  fixturesArg: LlmUsageContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("LlmUsageRepository contract", () => {
    let repo: LlmUsageRepository;
    let fixtures: LlmUsageContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create devuelve la fila con id y created_at", async () => {
      const u = await repo.create(base(fixtures));

      expect(u.id).toBeTypeOf("string");
      expect(u.modelo).toBe("gpt-4o-mini");
      expect(u.input_tokens).toBe(1200);
      expect(u.workflow).toBe("ai-agent");
      expect(u.created_at).toBeInstanceOf(Date);
    });

    // `costo_usd` es `numeric` en Postgres y llega como string por PostgREST si
    // nadie lo convierte. Un costo que viaja como texto rompe toda suma y el
    // reporte de gasto quedaría en "0" o en "NaN" sin fallar en ningún lado.
    test("el costo vuelve como número, no como texto", async () => {
      const u = await repo.create(base(fixtures, { costo_usd: 0.00036 }));

      expect(typeof u.costo_usd).toBe("number");
      expect(u.costo_usd).toBeCloseTo(0.00036, 8);
    });

    describe("resumenPorLeadSession", () => {
      test("suma el gasto y cuenta las llamadas de la sesión", async () => {
        await repo.create(base(fixtures, { costo_usd: 0.001 }));
        await repo.create(base(fixtures, { costo_usd: 0.002 }));

        const r = await repo.resumenPorLeadSession(fixtures.leadSessionIds.s1);

        expect(r.llamadas).toBe(2);
        expect(r.usd).toBeCloseTo(0.003, 8);
      });

      test("no mezcla sesiones", async () => {
        await repo.create(base(fixtures, { lead_session_id: fixtures.leadSessionIds.s1 }));
        await repo.create(base(fixtures, { lead_session_id: fixtures.leadSessionIds.s2 }));

        expect((await repo.resumenPorLeadSession(fixtures.leadSessionIds.s1)).llamadas).toBe(1);
      });

      // Cero llamadas no es lo mismo que cero gasto conocido, pero el contrato
      // promete ceros y no una excepción: una sesión vieja simplemente no tiene
      // filas y la pantalla tiene que poder pintarla igual.
      test("una sesión sin filas da todo en cero", async () => {
        const r = await repo.resumenPorLeadSession(fixtures.leadSessionIds.s2);

        expect(r).toEqual({ usd: 0, llamadas: 0 });
      });

      // Qué cuenta como "gasto de esta conversación" es decisión del caller:
      // el resumen del extractor no es plata que gastó el vendedor hablando.
      test("excluirWorkflows saca esos del corte", async () => {
        await repo.create(base(fixtures, { workflow: "ai-agent", costo_usd: 0.001 }));
        await repo.create(base(fixtures, { workflow: "twin-extractor", costo_usd: 0.005 }));

        const r = await repo.resumenPorLeadSession(fixtures.leadSessionIds.s1, {
          excluirWorkflows: ["twin-extractor"],
        });

        expect(r.llamadas).toBe(1);
        expect(r.usd).toBeCloseTo(0.001, 8);
      });
    });

    describe("primerRegistroAt", () => {
      // Es la frontera de la medición: sin esto, una conversación anterior a la
      // instrumentación diría que salió gratis, que es mentira.
      test("con la tabla vacía devuelve null", async () => {
        expect(await repo.primerRegistroAt()).toBeNull();
      });

      test("con filas devuelve una fecha", async () => {
        await repo.create(base(fixtures));

        expect(await repo.primerRegistroAt()).toBeInstanceOf(Date);
      });
    });

    test("listByMensajeId devuelve las llamadas de ese mensaje", async () => {
      await repo.create(base(fixtures, { mensaje_id: fixtures.mensajeIds.m1 }));
      await repo.create(base(fixtures, { mensaje_id: fixtures.mensajeIds.m2 }));

      const delM1 = await repo.listByMensajeId(fixtures.mensajeIds.m1);

      expect(delM1).toHaveLength(1);
      expect(delM1[0]?.mensaje_id).toBe(fixtures.mensajeIds.m1);
    });

    test("listDesde recorta por fecha", async () => {
      await repo.create(base(fixtures));

      const futuro = new Date(Date.now() + 60_000);
      const pasado = new Date(Date.now() - 60_000);

      expect(await repo.listDesde(futuro)).toEqual([]);
      expect((await repo.listDesde(pasado)).length).toBeGreaterThan(0);
    });

    // El cron de reactivación y el kill switch cuentan gasto sin sesión: una
    // llamada de sistema no cuelga de ninguna conversación.
    test("acepta una llamada sin sesión ni mensaje", async () => {
      const u = await repo.create(
        base(fixtures, { lead_session_id: null, mensaje_id: null, workflow: "intent-batch" }),
      );

      expect(u.lead_session_id).toBeNull();
      expect(u.mensaje_id).toBeNull();
    });
  });
}
