import { beforeEach, describe, expect, test } from "vitest";
import { NotFoundError } from "@/lib/errors";
import type { HandoffEventsRepository } from "@/server/repositories/handoff-events.repo";
import type { UUID } from "@/types/entities";

export interface HandoffEventsContractFixtures {
  /** Dos sesiones activas de leads distintos. */
  sessionIds: { s1: UUID; s2: UUID };
  /** Un id que no corresponde a ninguna sesión. */
  desconocida: UUID;
}

const DEFAULT_FIXTURES: HandoffEventsContractFixtures = {
  sessionIds: { s1: "sess-1", s2: "sess-2" },
  desconocida: "00000000-0000-4000-8000-000000000999",
};

export type HandoffEventsContractFixturesArg =
  | HandoffEventsContractFixtures
  | (() => HandoffEventsContractFixtures);

export function runHandoffEventsContract(
  makeRepo: () => HandoffEventsRepository,
  fixturesArg: HandoffEventsContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("HandoffEventsRepository contract", () => {
    let repo: HandoffEventsRepository;
    let fixtures: HandoffEventsContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    // Escalar es una transición de dos partes: se anota el evento Y se pausa la
    // IA de la sesión. Si solo pasara una, el agente seguiría contestando sobre
    // una conversación que ya se le entregó a una persona.
    test("pause anota el evento y pausa la IA de la sesión", async () => {
      const { event, session } = await repo.transition({
        sessionId: fixtures.sessionIds.s1,
        action: "pause",
        reasonCode: "rule_handoff",
        source: "rule",
        sourceEventKey: `pause-${fixtures.sessionIds.s1}-1`,
        notifyCustomer: true,
      });

      expect(event.lead_session_id).toBe(fixtures.sessionIds.s1);
      expect(event.action).toBe("pause");
      expect(event.reason_code).toBe("rule_handoff");
      expect(event.source).toBe("rule");
      expect(session.ia_pausada).toBe(true);
      expect(session.current_stage).toBe("requiere_humano");
    });

    test("resume devuelve la conversación a la IA", async () => {
      await repo.transition({
        sessionId: fixtures.sessionIds.s1,
        action: "pause",
        reasonCode: "rule_handoff",
        source: "rule",
        sourceEventKey: `pause-${fixtures.sessionIds.s1}-2`,
        notifyCustomer: false,
      });

      const { session } = await repo.transition({
        sessionId: fixtures.sessionIds.s1,
        action: "resume",
        reasonCode: "manual_resume",
        source: "admin",
        sourceEventKey: `resume-${fixtures.sessionIds.s1}-2`,
        notifyCustomer: false,
      });

      expect(session.ia_pausada).toBe(false);
    });

    // Inngest reintenta pasos. Sin idempotencia por `source_event_key`, un
    // replay dejaría dos escalados del mismo hecho y el historial diría que al
    // cliente lo pasaron a humano dos veces.
    test("el mismo source_event_key no duplica el evento", async () => {
      const clave = `pause-${fixtures.sessionIds.s1}-idem`;
      const input = {
        sessionId: fixtures.sessionIds.s1,
        action: "pause" as const,
        reasonCode: "rule_handoff" as const,
        source: "rule" as const,
        sourceEventKey: clave,
        notifyCustomer: true,
      };

      const primera = await repo.transition(input);
      const segunda = await repo.transition(input);

      expect(segunda.event.id).toBe(primera.event.id);
      expect(await repo.listBySessionIds([fixtures.sessionIds.s1])).toHaveLength(1);
    });

    test("listBySessionIds devuelve los eventos de esas sesiones", async () => {
      await repo.transition({
        sessionId: fixtures.sessionIds.s1,
        action: "pause",
        reasonCode: "rule_handoff",
        source: "rule",
        sourceEventKey: `pause-s1-list`,
        notifyCustomer: false,
      });
      await repo.transition({
        sessionId: fixtures.sessionIds.s2,
        action: "pause",
        reasonCode: "sensitive_keyword",
        source: "agent_guard",
        sourceEventKey: `pause-s2-list`,
        notifyCustomer: false,
      });

      const soloS1 = await repo.listBySessionIds([fixtures.sessionIds.s1]);

      expect(soloS1).toHaveLength(1);
      expect(soloS1[0]?.lead_session_id).toBe(fixtures.sessionIds.s1);
    });

    test("listBySessionIds con lista vacía devuelve vacío sin consultar", async () => {
      expect(await repo.listBySessionIds([])).toEqual([]);
    });

    test("una sesión inexistente lanza NotFoundError", async () => {
      await expect(
        repo.transition({
          sessionId: fixtures.desconocida,
          action: "pause",
          reasonCode: "rule_handoff",
          source: "rule",
          sourceEventKey: "pause-inexistente",
          notifyCustomer: false,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    // El rail del Twin necesita saber a qué etapa volver cuando se retoma.
    test("guarda la etapa previa al escalado", async () => {
      const { event } = await repo.transition({
        sessionId: fixtures.sessionIds.s2,
        action: "pause",
        reasonCode: "sensitive_keyword",
        source: "agent_guard",
        sourceEventKey: `pause-s2-etapa`,
        notifyCustomer: false,
      });

      expect(event.previous_stage).not.toBeUndefined();
    });
  });
}
