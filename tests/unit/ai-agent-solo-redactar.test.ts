import { beforeEach, describe, expect, test, vi } from "vitest";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import type { HandoffService } from "@/server/services/handoff.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { FakeAgentLLM } from "../mocks/llm";

/**
 * `soloRedactar` es lo que hace que "Regenerar" del copiloto no tenga efectos:
 * un escalado normal pausa la sesión y avisa al cliente (`notifyCustomer`).
 */
describe("AiAgentService.respond — soloRedactar", () => {
  let sessions: InMemoryLeadSessionRepository;
  let intents: InMemoryIntentsRepository;
  let rules: InMemoryRulesRepository;
  let llm: FakeAgentLLM;
  let pause: ReturnType<typeof vi.fn>;
  let svc: DefaultAiAgentService;

  async function sesion() {
    return sessions.create({
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

  async function reglaHandoff() {
    const intent = await intents.create({
      nombre: "reclamo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    await rules.create({
      intent_id: intent.id,
      condiciones_extra: null,
      respuesta_tipo: "handoff",
      respuesta_contenido: "Pasando a humano",
      prioridad: 0,
      activa: true,
    });
  }

  beforeEach(() => {
    sessions = new InMemoryLeadSessionRepository();
    intents = new InMemoryIntentsRepository();
    rules = new InMemoryRulesRepository();
    llm = new FakeAgentLLM();
    pause = vi.fn(async () => {
      throw new Error("no debería pausar");
    });
    const handoff = { pause } as unknown as HandoffService;
    svc = new DefaultAiAgentService(
      sessions,
      new DefaultRuleEngineService(intents, rules, new InMemoryReglasEtiquetaRepository()),
      new DefaultCatalogMatcherService(new InMemoryProductsRepository()),
      llm,
      undefined,
      undefined,
      handoff,
    );
  });

  test("palabra sensible con soloRedactar: handoff marcado escalada, sin pausar ni tocar la sesión", async () => {
    const s = await sesion();
    llm.conConfig({ escalar_palabras: ["abogado"] });
    const update = vi.spyOn(sessions, "update");

    const r = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["lead: llamo a mi abogado"],
      classification: { intent_nombre: null, confidence: 0 },
      soloRedactar: true,
    });

    expect(r).toMatchObject({ source: "handoff", escalada: true });
    expect(pause).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(await sessions.findById(s.id)).toMatchObject({
      ia_pausada: false,
      current_stage: "nuevo",
    });
    expect(llm.calls).toHaveLength(0);
  });

  test("cotización sobre el tope (quote_limit) con soloRedactar: sin pausar ni tocar la sesión", async () => {
    const s = await sesion();
    await sessions.update(s.id, { precio_cotizado: 750_000 });
    llm.conConfig({ escalar_cotizacion_desde: 500_000 });
    const update = vi.spyOn(sessions, "update");

    const r = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["lead: ¿me lo dejás más barato?"],
      classification: { intent_nombre: null, confidence: 0 },
      soloRedactar: true,
    });

    expect(r).toMatchObject({ source: "handoff", escalada: true });
    expect(pause).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect((await sessions.findById(s.id))?.ia_pausada).toBe(false);
  });

  test("regla de tipo handoff con soloRedactar: sin pausar ni tocar la sesión", async () => {
    const s = await sesion();
    await reglaHandoff();
    const update = vi.spyOn(sessions, "update");

    const r = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["lead: quiero reclamar"],
      classification: { intent_nombre: "reclamo", confidence: 0.9 },
      soloRedactar: true,
    });

    expect(r).toMatchObject({
      source: "handoff",
      respuesta_contenido: "Pasando a humano",
      escalada: true,
    });
    expect(pause).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect((await sessions.findById(s.id))?.ia_pausada).toBe(false);
  });

  test("sin la opción el pipeline sigue pausando como antes (palabra sensible)", async () => {
    const s = await sesion();
    llm.conConfig({ escalar_palabras: ["abogado"] });
    pause.mockResolvedValue(s);

    const r = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["lead: llamo a mi abogado"],
      classification: { intent_nombre: null, confidence: 0 },
    });

    expect(r.source).toBe("handoff");
    expect(r.escalada).toBeUndefined();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: s.id,
        reasonCode: "sensitive_keyword",
        notifyCustomer: true,
      }),
    );
  });

  test("sin la opción la regla handoff sigue pausando como antes", async () => {
    const s = await sesion();
    await reglaHandoff();
    pause.mockResolvedValue(s);

    const r = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["lead: quiero reclamar"],
      classification: { intent_nombre: "reclamo", confidence: 0.9 },
    });

    expect(r.source).toBe("handoff");
    expect(r.escalada).toBeUndefined();
    expect(pause).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "rule_handoff", notifyCustomer: true }),
    );
  });

  test("con soloRedactar un turno que no escala responde igual que siempre", async () => {
    const s = await sesion();
    llm.enqueueText("Hola, ¿en qué te ayudo?");

    const r = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["lead: hola"],
      classification: { intent_nombre: null, confidence: 0 },
      soloRedactar: true,
    });

    expect(r).toMatchObject({ source: "llm", respuesta_contenido: "Hola, ¿en qué te ayudo?" });
    expect(r.escalada).toBeUndefined();
  });
});
