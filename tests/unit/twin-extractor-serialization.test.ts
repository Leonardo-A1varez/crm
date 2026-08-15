import { describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemorySessionLock } from "@/server/lock/session-lock";
import { DefaultTwinExtractorService } from "@/server/services/twin-extractor.service";
import type { LeadTwinUpdate } from "@/lib/validation/ai";
import { InMemoryLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.repo";
import type {
  TwinExtractorLLM,
  TwinExtractorLLMInput,
} from "@/server/services/twin-extractor.service";

class SlowTrackingLLM implements TwinExtractorLLM {
  inFlight = 0;
  peak = 0;
  public readonly responses: LeadTwinUpdate[] = [];

  enqueue(r: LeadTwinUpdate): this {
    this.responses.push(r);
    return this;
  }

  async extract(_input: TwinExtractorLLMInput): Promise<LeadTwinUpdate> {
    this.inFlight++;
    this.peak = Math.max(this.peak, this.inFlight);
    await new Promise((r) => setTimeout(r, 15));
    const next = this.responses.shift();
    this.inFlight--;
    if (!next) throw new Error("SlowTrackingLLM: sin respuesta encolada");
    return next;
  }
}

async function seedSession(repo: InMemoryLeadSessionRepository) {
  return repo.create({
    lead_id: crypto.randomUUID(),
    current_stage: "nuevo",
    urgencia: "media",
    consulta: "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
  });
}

describe("TwinExtractorService single-flight per session", () => {
  test("con InMemorySessionLock 2 extracts paralelos misma sesión serializan", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const llm = new SlowTrackingLLM();
    const lock = new InMemorySessionLock();
    const svc = new DefaultTwinExtractorService(
      sessions,
      llm,
      new InMemoryLeadVehiculosRepository(),
      lock,
    );

    const s = await seedSession(sessions);
    llm.enqueue({ current_stage: "identificando" });
    llm.enqueue({ current_stage: "cotizado" });

    await Promise.all([
      svc.extract({ sessionId: s.id, conversationTurn: ["turn1"] }),
      svc.extract({ sessionId: s.id, conversationTurn: ["turn2"] }),
    ]);

    expect(llm.peak).toBe(1);

    const final = await sessions.findById(s.id);
    expect(final!.current_stage).toBe("cotizado");
  });

  test("sesiones distintas permiten paralelismo", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const llm = new SlowTrackingLLM();
    const lock = new InMemorySessionLock();
    const svc = new DefaultTwinExtractorService(
      sessions,
      llm,
      new InMemoryLeadVehiculosRepository(),
      lock,
    );

    const s1 = await seedSession(sessions);
    const s2 = await seedSession(sessions);
    llm.enqueue({ current_stage: "identificando" });
    llm.enqueue({ current_stage: "identificando" });

    await Promise.all([
      svc.extract({ sessionId: s1.id, conversationTurn: ["a"] }),
      svc.extract({ sessionId: s2.id, conversationTurn: ["b"] }),
    ]);

    expect(llm.peak).toBe(2);
  });

  test("error en primer extract libera lock para siguiente", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const llm = new SlowTrackingLLM();
    const lock = new InMemorySessionLock();
    const svc = new DefaultTwinExtractorService(
      sessions,
      llm,
      new InMemoryLeadVehiculosRepository(),
      lock,
    );

    const s = await seedSession(sessions);
    // Primera llamada Zod parse fail → ValidationError.
    llm.enqueue({ current_stage: "INVALIDO" as never });
    llm.enqueue({ current_stage: "identificando" });

    const p1 = svc.extract({ sessionId: s.id, conversationTurn: ["a"] });
    const p2 = svc.extract({ sessionId: s.id, conversationTurn: ["b"] });

    await expect(p1).rejects.toThrow();
    const result2 = await p2;
    expect(result2.current_stage).toBe("identificando");
  });
});
