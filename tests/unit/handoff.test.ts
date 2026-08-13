import { beforeEach, describe, expect, test } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { InMemoryHandoffEventsRepository } from "@/server/repositories/handoff-events.repo";
import type { LeadSession } from "@/types/entities";
import type { IntentClassification } from "@/lib/validation/ai";

async function createSession(
  repo: InMemoryLeadSessionRepository,
  overrides: Partial<Omit<LeadSession, "id" | "started_at" | "closed_at">> = {},
): Promise<LeadSession> {
  return repo.create({
    lead_id: overrides.lead_id ?? crypto.randomUUID(),
    current_stage: overrides.current_stage ?? "nuevo",
    urgencia: overrides.urgencia ?? "media",
    consulta: overrides.consulta ?? "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: overrides.resultado ?? null,
    motivo_perdida: null,
    ia_pausada: overrides.ia_pausada ?? false,
  });
}

function cls(intent_nombre: string | null): IntentClassification {
  return { intent_nombre, confidence: intent_nombre === null ? 0 : 0.8 };
}

describe("HandoffService", () => {
  let sessions: InMemoryLeadSessionRepository;
  let svc: DefaultHandoffService;

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    svc = new DefaultHandoffService(sessions);
  });

  describe("pause", () => {
    test("activa ia_pausada en sesion abierta", async () => {
      const s = await createSession(sessions);
      const result = await svc.pause(s.id, "vendedor pidio control");
      expect(result.ia_pausada).toBe(true);
    });

    test("idempotente cuando ya esta pausada", async () => {
      const s = await createSession(sessions, { ia_pausada: true });
      const result = await svc.pause(s.id, "ya estaba");
      expect(result.ia_pausada).toBe(true);
    });

    test("sesion cerrada lanza error", async () => {
      const s = await createSession(sessions);
      await sessions.close(s.id, { resultado: "exito" });
      await expect(svc.pause(s.id, "x")).rejects.toThrow(/cerrada/i);
    });

    test("sesion inexistente lanza error", async () => {
      await expect(svc.pause("fake-id", "x")).rejects.toThrow(/no encontrada/i);
    });
  });

  describe("resume", () => {
    test("desactiva ia_pausada", async () => {
      const s = await createSession(sessions, { ia_pausada: true });
      const result = await svc.resume(s.id);
      expect(result.ia_pausada).toBe(false);
    });

    test("idempotente cuando ya esta activa", async () => {
      const s = await createSession(sessions, { ia_pausada: false });
      const result = await svc.resume(s.id);
      expect(result.ia_pausada).toBe(false);
    });

    test("sesion cerrada lanza error", async () => {
      const s = await createSession(sessions);
      await sessions.close(s.id, { resultado: "exito" });
      await expect(svc.resume(s.id)).rejects.toThrow(/cerrada/i);
    });

    test("restaura la etapa previa y deja historial append-only", async () => {
      const events = new InMemoryHandoffEventsRepository(sessions);
      const withEvents = new DefaultHandoffService(sessions, undefined, events);
      const s = await createSession(sessions, { current_stage: "negociando" });

      const paused = await withEvents.pause({
        sessionId: s.id,
        reasonCode: "unknown_intents",
        source: "auto_handoff",
        sourceEventKey: "auto:evt-1",
        notifyCustomer: true,
      });
      expect(paused).toMatchObject({
        ia_pausada: true,
        current_stage: "requiere_humano",
        stage_before_handoff: "negociando",
      });

      const resumed = await withEvents.resume({ sessionId: s.id, sourceEventKey: "admin:evt-2" });
      expect(resumed).toMatchObject({
        ia_pausada: false,
        current_stage: "negociando",
        stage_before_handoff: null,
      });
      expect((await events.listBySessionIds([s.id])).map((event) => event.action)).toEqual([
        "pause",
        "resume",
      ]);
    });

    test("la misma sourceEventKey no duplica el evento", async () => {
      const events = new InMemoryHandoffEventsRepository(sessions);
      const withEvents = new DefaultHandoffService(sessions, undefined, events);
      const s = await createSession(sessions);
      const input = {
        sessionId: s.id,
        reasonCode: "manual_pause" as const,
        source: "admin" as const,
        sourceEventKey: "manual:una-accion",
      };
      await withEvents.pause(input);
      await events.transition({ ...input, action: "pause", notifyCustomer: false });
      expect(await events.listBySessionIds([s.id])).toHaveLength(1);
    });
  });

  describe("evaluate", () => {
    test("sin threshold usa el de fabrica (2), no el 3 que estaba fijo en codigo", async () => {
      const decision = svc.evaluate({
        recentClassifications: [cls("saludo"), cls(null), cls(null)],
      });
      expect(decision.pausar_ia).toBe(true);
      expect(decision.motivo).toMatch(/2 intents desconocidos/i);
    });

    test("menos nulls que el umbral de fabrica no dispara", async () => {
      const decision = svc.evaluate({
        recentClassifications: [cls(null)],
      });
      expect(decision.pausar_ia).toBe(false);
    });

    test("nulls intercalados con valido al final no dispara (no consecutivos)", async () => {
      const decision = svc.evaluate({
        recentClassifications: [cls(null), cls(null), cls("saludo")],
      });
      expect(decision.pausar_ia).toBe(false);
    });

    test("threshold custom respeta", async () => {
      const decision = svc.evaluate({
        recentClassifications: [cls(null), cls(null)],
        threshold: 2,
      });
      expect(decision.pausar_ia).toBe(true);
      expect(decision.motivo).toMatch(/2 intents desconocidos/i);
    });

    test("lista vacia no dispara", async () => {
      const decision = svc.evaluate({ recentClassifications: [] });
      expect(decision.pausar_ia).toBe(false);
    });

    test("mas nulls que threshold al final dispara con N=threshold en motivo", async () => {
      const decision = svc.evaluate({
        recentClassifications: [cls(null), cls(null), cls(null), cls(null), cls(null)],
        threshold: 3,
      });
      expect(decision.pausar_ia).toBe(true);
      expect(decision.motivo).toMatch(/3 intents desconocidos/i);
    });

    test("umbral fuera del rango 1-5 se acota en vez de desactivar el handoff", async () => {
      // Una fila editada a mano en la DB puede traer 0 o 99: 0 pausaria cada
      // conversacion y 99 no pausaria ninguna.
      expect(svc.evaluate({ recentClassifications: [cls(null)], threshold: 0 }).motivo).toMatch(
        /1 intents desconocidos/i,
      );
      const nueveNulls = Array.from({ length: 9 }, () => cls(null));
      expect(svc.evaluate({ recentClassifications: nueveNulls, threshold: 99 }).motivo).toMatch(
        /5 intents desconocidos/i,
      );
    });
  });

  describe("evaluateConConfig", () => {
    function conUmbral(escalar_umbral_intents: number): DefaultHandoffService {
      return new DefaultHandoffService(
        sessions,
        new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, escalar_umbral_intents }),
      );
    }

    test("toma el umbral de la config activa y no el de fabrica", async () => {
      const decision = await conUmbral(4).evaluateConConfig({
        recentClassifications: [cls(null), cls(null), cls(null), cls(null)],
      });
      expect(decision.pausar_ia).toBe(true);
      expect(decision.motivo).toMatch(/4 intents desconocidos/i);
    });

    test("con umbral 4 en config, 3 nulls todavia no disparan", async () => {
      const decision = await conUmbral(4).evaluateConConfig({
        recentClassifications: [cls(null), cls(null), cls(null)],
      });
      expect(decision.pausar_ia).toBe(false);
    });

    test("un threshold explicito le gana a la config", async () => {
      const decision = await conUmbral(5).evaluateConConfig({
        recentClassifications: [cls(null), cls(null)],
        threshold: 2,
      });
      expect(decision.pausar_ia).toBe(true);
      expect(decision.motivo).toMatch(/2 intents desconocidos/i);
    });

    test("sin provider inyectado cae en el de fabrica", async () => {
      const decision = await svc.evaluateConConfig({
        recentClassifications: [cls(null), cls(null)],
      });
      expect(decision.pausar_ia).toBe(true);
      expect(decision.motivo).toMatch(/2 intents desconocidos/i);
    });
  });
});
