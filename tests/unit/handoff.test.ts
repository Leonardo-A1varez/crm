import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
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
  });

  describe("evaluate", () => {
    test("threshold default = 3 consecutive nulls al final dispara handoff", async () => {
      const decision = svc.evaluate({
        recentClassifications: [cls("saludo"), cls(null), cls(null), cls(null)],
      });
      expect(decision.pausar_ia).toBe(true);
      expect(decision.motivo).toMatch(/3 intents desconocidos/i);
    });

    test("menos de 3 nulls no dispara", async () => {
      const decision = svc.evaluate({
        recentClassifications: [cls(null), cls(null)],
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
  });
});
