import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { DefaultConversationSummarizerService } from "@/server/services/conversation-summarizer.service";
import { NotFoundError } from "@/lib/errors";
import { FakeConversationSummarizerLLM } from "../mocks/llm";

async function seedSession(repo: InMemoryLeadSessionRepository, summary: string | null = null) {
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
    context_summary: summary,
  });
}

describe("ConversationSummarizerService", () => {
  let sessions: InMemoryLeadSessionRepository;
  let llm: FakeConversationSummarizerLLM;
  let svc: DefaultConversationSummarizerService;

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    llm = new FakeConversationSummarizerLLM();
    svc = new DefaultConversationSummarizerService(sessions, llm);
  });

  test("summarize llama LLM con history + persiste a session.context_summary", async () => {
    const s = await seedSession(sessions);
    llm.enqueue("Lead pidió pastillas Corolla, quedó esperando precio.");

    const result = await svc.summarize({
      sessionId: s.id,
      history: ["lead: hola", "ia: ¿qué auto?", "lead: corolla 2018"],
    });

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].sessionId).toBe(s.id);
    expect(llm.calls[0].history).toEqual(["lead: hola", "ia: ¿qué auto?", "lead: corolla 2018"]);
    expect(llm.calls[0].previousSummary).toBeNull();
    expect(result.context_summary).toBe("Lead pidió pastillas Corolla, quedó esperando precio.");
  });

  test("summarize con previousSummary pasa a LLM", async () => {
    const s = await seedSession(sessions, "Resumen anterior");
    llm.enqueue("Resumen actualizado");

    await svc.summarize({ sessionId: s.id, history: ["lead: y modelo?"] });

    expect(llm.calls[0].previousSummary).toBe("Resumen anterior");
  });

  test("sesión inexistente lanza NotFoundError", async () => {
    await expect(svc.summarize({ sessionId: "fake", history: [] })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(llm.calls).toHaveLength(0);
  });

  test("sesión cerrada retorna current sin llamar LLM", async () => {
    const s = await seedSession(sessions);
    const closed = await sessions.close(s.id, { resultado: "exito" });

    const result = await svc.summarize({ sessionId: s.id, history: ["x"] });

    expect(llm.calls).toHaveLength(0);
    expect(result.id).toBe(closed.id);
  });

  test("update sobrescribe context_summary previo", async () => {
    const s = await seedSession(sessions, "viejo");
    llm.enqueue("nuevo");

    const result = await svc.summarize({ sessionId: s.id, history: ["x"] });

    expect(result.context_summary).toBe("nuevo");
    const refetch = await sessions.findById(s.id);
    expect(refetch!.context_summary).toBe("nuevo");
  });

  describe("shouldSummarize threshold (B4)", () => {
    test("false bajo threshold default 20", () => {
      expect(svc.shouldSummarize(0)).toBe(false);
      expect(svc.shouldSummarize(10)).toBe(false);
      expect(svc.shouldSummarize(19)).toBe(false);
    });

    test("true al/sobre threshold default 20", () => {
      expect(svc.shouldSummarize(20)).toBe(true);
      expect(svc.shouldSummarize(50)).toBe(true);
    });

    test("threshold custom override en constructor", () => {
      const custom = new DefaultConversationSummarizerService(sessions, llm, 5);
      expect(custom.shouldSummarize(4)).toBe(false);
      expect(custom.shouldSummarize(5)).toBe(true);
      expect(custom.shouldSummarize(10)).toBe(true);
    });
  });
});
