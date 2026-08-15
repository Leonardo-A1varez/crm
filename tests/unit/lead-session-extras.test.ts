import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { DefaultTwinExtractorService } from "@/server/services/twin-extractor.service";
import { FakeTwinExtractorLLM } from "../mocks/llm";
import { InMemoryLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.repo";

async function seedSession(repo: InMemoryLeadSessionRepository, extras = {}) {
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
    extras,
  });
}

describe("LeadSession extras column", () => {
  let repo: InMemoryLeadSessionRepository;

  beforeEach(() => {
    repo = new InMemoryLeadSessionRepository();
  });

  test("create sin extras default a objeto vacío", async () => {
    const s = await repo.create({
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
    expect(s.extras).toEqual({});
  });

  test("create con extras persiste keys", async () => {
    const s = await seedSession(repo, { preferencia: "rapido", color: "rojo" });
    expect(s.extras).toEqual({ preferencia: "rapido", color: "rojo" });
  });

  test("update con extras replace completo", async () => {
    const s = await seedSession(repo, { a: 1, b: 2 });
    const updated = await repo.update(s.id, { extras: { c: 3 } });
    expect(updated.extras).toEqual({ c: 3 });
  });

  test("update sin extras preserva existing", async () => {
    const s = await seedSession(repo, { a: 1 });
    const updated = await repo.update(s.id, { current_stage: "cotizado" });
    expect(updated.extras).toEqual({ a: 1 });
  });

  test("extras deep-clone defense (mutación externa no afecta storage)", async () => {
    const s = await seedSession(repo, { nested: { deep: 1 } });
    (s.extras.nested as { deep: number }).deep = 999;

    const refetch = await repo.findById(s.id);
    expect((refetch!.extras.nested as { deep: number }).deep).toBe(1);
  });
});

describe("twin-extractor extras shallow merge", () => {
  let repo: InMemoryLeadSessionRepository;
  let llm: FakeTwinExtractorLLM;
  let svc: DefaultTwinExtractorService;

  beforeEach(() => {
    repo = new InMemoryLeadSessionRepository();
    llm = new FakeTwinExtractorLLM();
    svc = new DefaultTwinExtractorService(repo, llm, new InMemoryLeadVehiculosRepository());
  });

  test("LLM extras se mergea con existing extras", async () => {
    const s = await seedSession(repo, { preferencia: "rapido" });
    llm.enqueue({ extras: { observacion: "primer contacto" } });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["x"] });

    expect(result.extras).toEqual({
      preferencia: "rapido",
      observacion: "primer contacto",
    });
  });

  test("LLM extras con misma key sobrescribe", async () => {
    const s = await seedSession(repo, { color: "rojo" });
    llm.enqueue({ extras: { color: "azul" } });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["x"] });

    expect(result.extras).toEqual({ color: "azul" });
  });

  test("LLM sin extras preserva existing", async () => {
    const s = await seedSession(repo, { keep: "me" });
    llm.enqueue({ current_stage: "identificando" });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["x"] });

    expect(result.extras).toEqual({ keep: "me" });
    expect(result.current_stage).toBe("identificando");
  });

  test("LLM extras vacío no toca existing (no-op)", async () => {
    const s = await seedSession(repo, { keep: "me" });
    llm.enqueue({ extras: {} });

    const result = await svc.extract({ sessionId: s.id, conversationTurn: ["x"] });

    expect(result.extras).toEqual({ keep: "me" });
  });
});
