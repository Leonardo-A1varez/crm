import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { DefaultTwinExtractorService } from "@/server/services/twin-extractor.service";
import type { LeadSession } from "@/types/entities";
import { FakeTwinExtractorLLM } from "../mocks/llm";

async function createActiveSession(
  repo: InMemoryLeadSessionRepository,
  overrides: Partial<Omit<LeadSession, "id" | "started_at" | "closed_at">> = {},
): Promise<LeadSession> {
  return repo.create({
    lead_id: overrides.lead_id ?? crypto.randomUUID(),
    current_stage: overrides.current_stage ?? "nuevo",
    urgencia: overrides.urgencia ?? "media",
    consulta: overrides.consulta ?? "",
    producto_cotizado_id: overrides.producto_cotizado_id ?? null,
    codigo_interno: overrides.codigo_interno ?? null,
    precio_cotizado: overrides.precio_cotizado ?? null,
    cantidad: overrides.cantidad ?? null,
    bloqueador: overrides.bloqueador ?? null,
    comprobante_pago_url: overrides.comprobante_pago_url ?? null,
    metodo_pago: overrides.metodo_pago ?? null,
    resultado: overrides.resultado ?? null,
    motivo_perdida: overrides.motivo_perdida ?? null,
    ia_pausada: overrides.ia_pausada ?? false,
  });
}

describe("TwinExtractorService.extract", () => {
  let sessions: InMemoryLeadSessionRepository;
  let llm: FakeTwinExtractorLLM;
  let svc: DefaultTwinExtractorService;

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    llm = new FakeTwinExtractorLLM();
    svc = new DefaultTwinExtractorService(sessions, llm);
  });

  test("sesion no existe lanza error", async () => {
    await expect(
      svc.extract({ sessionId: "no-existe", conversationTurn: ["hola"] }),
    ).rejects.toThrow(/no encontrada/i);
    expect(llm.calls).toHaveLength(0);
  });

  test("sesion ya cerrada no llama LLM y retorna sesion sin cambios", async () => {
    const s = await createActiveSession(sessions);
    const closed = await sessions.close(s.id, { resultado: "exito" });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["hola"] });

    expect(llm.calls).toHaveLength(0);
    expect(result).toEqual(closed);
  });

  test("patch parcial aplica update sin tocar resultado", async () => {
    const s = await createActiveSession(sessions, { current_stage: "nuevo" });
    llm.enqueue({
      current_stage: "cotizado",
      urgencia: "alta",
      precio_cotizado: 120,
    });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

    expect(result.current_stage).toBe("cotizado");
    expect(result.urgencia).toBe("alta");
    expect(result.precio_cotizado).toBe(120);
    expect(result.resultado).toBeNull();
  });

  test("patch vacio no toca sesion", async () => {
    const s = await createActiveSession(sessions, { current_stage: "negociando" });
    llm.enqueue({});

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

    expect(result).toEqual(s);
  });

  test("LLM devuelve resultado=exito invoca close y retorna sesion cerrada", async () => {
    const s = await createActiveSession(sessions, { current_stage: "esperando_pago" });
    llm.enqueue({ resultado: "exito" });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["pagado"] });

    expect(result.resultado).toBe("exito");
    expect(result.closed_at).toBeInstanceOf(Date);
  });

  test("LLM devuelve resultado=perdido con motivo cierra con motivo", async () => {
    const s = await createActiveSession(sessions);
    llm.enqueue({ resultado: "perdido", motivo_perdida: "precio" });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["caro"] });

    expect(result.resultado).toBe("perdido");
    expect(result.motivo_perdida).toBe("precio");
  });

  test("LLM devuelve otros campos + resultado: aplica update y luego close", async () => {
    const s = await createActiveSession(sessions);
    llm.enqueue({
      current_stage: "cerrado",
      precio_cotizado: 200,
      cantidad: 1,
      resultado: "exito",
    });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });

    expect(result.current_stage).toBe("cerrado");
    expect(result.precio_cotizado).toBe(200);
    expect(result.cantidad).toBe(1);
    expect(result.resultado).toBe("exito");
    expect(result.closed_at).toBeInstanceOf(Date);
  });

  test("LLM recibe current session + conversation turn", async () => {
    const s = await createActiveSession(sessions, { current_stage: "identificando" });
    llm.enqueue({});

    await svc.extract({
      sessionId: s.id,
      conversationTurn: ["lead: hola", "ia: hola"],
    });

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].current.id).toBe(s.id);
    expect(llm.calls[0].current.current_stage).toBe("identificando");
    expect(llm.calls[0].conversationTurn).toEqual(["lead: hola", "ia: hola"]);
  });

  test("patch con campo invalido (no en LeadTwinUpdateSchema) es rechazado", async () => {
    const s = await createActiveSession(sessions);
    llm.enqueue({ current_stage: "valor-invalido" as never });

    await expect(svc.extract({ sessionId: s.id, conversationTurn: ["..."] })).rejects.toThrow();
  });

  test("patch puede setear bloqueador a string y luego limpiarlo con null", async () => {
    const s = await createActiveSession(sessions);
    llm.enqueue({ bloqueador: "espera comprobante" });
    const r1 = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });
    expect(r1.bloqueador).toBe("espera comprobante");

    llm.enqueue({ bloqueador: null });
    const r2 = await svc.extract({ sessionId: s.id, conversationTurn: ["..."] });
    expect(r2.bloqueador).toBeNull();
  });
});
