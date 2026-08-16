import { beforeEach, describe, expect, test } from "vitest";
import type {
  RuleExecutionInsert,
  RuleExecutionsRepository,
} from "@/server/repositories/rule-executions.repo";
import type { UUID } from "@/types/entities";

export interface RuleExecutionsContractFixtures {
  /** Reglas ya persistidas: la FK `regla_id` las exige. */
  reglaIds: { r1: UUID; r2: UUID };
  /** Mensajes entrantes ya persistidos. */
  mensajeIds: { m1: UUID; m2: UUID };
  /** Intent del que cuelgan esas reglas. */
  intentId: UUID;
}

const DEFAULT_FIXTURES: RuleExecutionsContractFixtures = {
  reglaIds: { r1: "regla-1", r2: "regla-2" },
  mensajeIds: { m1: "msg-1", m2: "msg-2" },
  intentId: "intent-1",
};

export type RuleExecutionsContractFixturesArg =
  | RuleExecutionsContractFixtures
  | (() => RuleExecutionsContractFixtures);

function base(
  fixtures: RuleExecutionsContractFixtures,
  overrides: Partial<RuleExecutionInsert> = {},
): RuleExecutionInsert {
  return {
    regla_id: fixtures.reglaIds.r1,
    mensaje_id: fixtures.mensajeIds.m1,
    matched_intent_id: fixtures.intentId,
    ...overrides,
  };
}

export function runRuleExecutionsContract(
  makeRepo: () => RuleExecutionsRepository,
  fixturesArg: RuleExecutionsContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("RuleExecutionsRepository contract", () => {
    let repo: RuleExecutionsRepository;
    let fixtures: RuleExecutionsContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create devuelve la fila con id y created_at", async () => {
      const e = await repo.create(base(fixtures));

      expect(e.id).toBeTypeOf("string");
      expect(e.regla_id).toBe(fixtures.reglaIds.r1);
      expect(e.mensaje_id).toBe(fixtures.mensajeIds.m1);
      expect(e.matched_intent_id).toBe(fixtures.intentId);
      expect(e.created_at).toBeInstanceOf(Date);
    });

    test("listByRegla devuelve solo los disparos de esa regla", async () => {
      await repo.create(base(fixtures, { regla_id: fixtures.reglaIds.r1 }));
      await repo.create(
        base(fixtures, { regla_id: fixtures.reglaIds.r2, mensaje_id: fixtures.mensajeIds.m2 }),
      );

      const deR1 = await repo.listByRegla(fixtures.reglaIds.r1);

      expect(deR1).toHaveLength(1);
      expect(deR1[0]?.regla_id).toBe(fixtures.reglaIds.r1);
    });

    test("listByRegla de una regla que nunca disparó devuelve vacío", async () => {
      expect(await repo.listByRegla(fixtures.reglaIds.r2)).toEqual([]);
    });

    test("findByMensajeId encuentra la regla que contestó ese mensaje", async () => {
      const creada = await repo.create(base(fixtures));

      const hallada = await repo.findByMensajeId(fixtures.mensajeIds.m1);

      expect(hallada?.id).toBe(creada.id);
      expect(hallada?.regla_id).toBe(fixtures.reglaIds.r1);
    });

    // Un mensaje que contestó el LLM no tiene fila acá: la tiene en
    // `turn_classifications`. Las dos tablas son mitades excluyentes.
    test("findByMensajeId devuelve null si ninguna regla contestó ese mensaje", async () => {
      expect(await repo.findByMensajeId(fixtures.mensajeIds.m2)).toBeNull();
    });

    // La tabla no tiene UNIQUE sobre `mensaje_id` (deuda anotada en la
    // migración de `turn_classifications`), así que un replay viejo puede haber
    // dejado dos filas idénticas. El contrato promete devolver una, no romper.
    test("con dos filas del mismo mensaje devuelve una sola", async () => {
      await repo.create(base(fixtures));
      await repo.create(base(fixtures));

      const hallada = await repo.findByMensajeId(fixtures.mensajeIds.m1);

      expect(hallada).not.toBeNull();
      expect(hallada?.mensaje_id).toBe(fixtures.mensajeIds.m1);
    });
  });
}
