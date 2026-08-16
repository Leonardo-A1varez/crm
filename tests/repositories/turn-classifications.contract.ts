import { beforeEach, describe, expect, test } from "vitest";
import type {
  TurnClassificationInsert,
  TurnClassificationsRepository,
} from "@/server/repositories/turn-classifications.repo";
import type { UUID } from "@/types/entities";

export interface TurnClassificationsContractFixtures {
  /** Mensajes entrantes ya persistidos: la FK `mensaje_id` los exige. */
  mensajeIds: { m1: UUID; m2: UUID };
  /** Intent activo al que se puede colgar una clasificación. */
  intentId: UUID;
}

const DEFAULT_FIXTURES: TurnClassificationsContractFixtures = {
  mensajeIds: { m1: "msg-1", m2: "msg-2" },
  intentId: "intent-1",
};

export type TurnClassificationsContractFixturesArg =
  | TurnClassificationsContractFixtures
  | (() => TurnClassificationsContractFixtures);

function base(
  fixtures: TurnClassificationsContractFixtures,
  overrides: Partial<TurnClassificationInsert> = {},
): TurnClassificationInsert {
  return {
    mensaje_id: fixtures.mensajeIds.m1,
    intent_id: fixtures.intentId,
    intent_nombre: "consulta_precio",
    confidence: 0.87,
    ...overrides,
  };
}

export function runTurnClassificationsContract(
  makeRepo: () => TurnClassificationsRepository,
  fixturesArg: TurnClassificationsContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("TurnClassificationsRepository contract", () => {
    let repo: TurnClassificationsRepository;
    let fixtures: TurnClassificationsContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create devuelve la fila con id y created_at", async () => {
      const t = await repo.create(base(fixtures));

      expect(t.id).toBeTypeOf("string");
      expect(t.mensaje_id).toBe(fixtures.mensajeIds.m1);
      expect(t.intent_nombre).toBe("consulta_precio");
      expect(t.confidence).toBeCloseTo(0.87, 5);
      expect(t.created_at).toBeInstanceOf(Date);
    });

    test("findByMensajeId encuentra la clasificación de ese mensaje", async () => {
      const creada = await repo.create(base(fixtures));

      const hallada = await repo.findByMensajeId(fixtures.mensajeIds.m1);

      expect(hallada?.id).toBe(creada.id);
    });

    test("findByMensajeId devuelve null para un mensaje sin clasificar", async () => {
      expect(await repo.findByMensajeId(fixtures.mensajeIds.m2)).toBeNull();
    });

    // El pipeline audita una vez por turno, pero Inngest reintenta pasos. Sin
    // idempotencia, un replay dejaría dos filas del mismo turno e inflaría el
    // conteo de uso del intent, que es justo lo que esta tabla sirve para medir.
    test("create es idempotente por mensaje_id: un replay no duplica el turno", async () => {
      const primera = await repo.create(base(fixtures));
      const segunda = await repo.create(
        base(fixtures, { intent_nombre: "otro_intent", confidence: 0.1 }),
      );

      expect(segunda.id).toBe(primera.id);
      // Gana la primera: la fila original es la evidencia de lo que pasó.
      expect(segunda.intent_nombre).toBe("consulta_precio");
    });

    // El clasificador no siempre reconoce algo, y ese "no reconocí nada" es un
    // dato: es lo que dispara el escalado por intents nulos consecutivos.
    test("acepta un turno sin intent reconocido", async () => {
      const t = await repo.create(
        base(fixtures, { intent_id: null, intent_nombre: null, confidence: 0 }),
      );

      expect(t.intent_id).toBeNull();
      expect(t.intent_nombre).toBeNull();
    });

    test("dos mensajes distintos conviven", async () => {
      await repo.create(base(fixtures, { mensaje_id: fixtures.mensajeIds.m1 }));
      await repo.create(base(fixtures, { mensaje_id: fixtures.mensajeIds.m2 }));

      expect(await repo.findByMensajeId(fixtures.mensajeIds.m1)).not.toBeNull();
      expect(await repo.findByMensajeId(fixtures.mensajeIds.m2)).not.toBeNull();
    });
  });
}
