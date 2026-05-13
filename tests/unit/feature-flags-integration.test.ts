import { describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { FLAGS, StaticFeatureFlags } from "@/lib/feature-flags";
import { autoHandoffHandler } from "@/inngest/functions/auto-handoff";
import { reactivationPredictorHandler } from "@/inngest/functions/reactivation-predictor.cron";
import { FakeAgentLLM } from "../mocks/llm";
import type { IntentClassification } from "@/lib/validation/ai";
import type { MotivoPerdida, Resultado } from "@/types/domain";
import type { LeadSession } from "@/types/entities";

function cls(n: string | null): IntentClassification {
  return { intent_nombre: n, confidence: n ? 0.9 : 0 };
}

async function seedSession(repo: InMemoryLeadSessionRepository): Promise<LeadSession> {
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

describe("ai-agent feature flag", () => {
  test("flag ai_agent.enabled=false → source handoff sin invocar LLM", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const intents = new InMemoryIntentsRepository();
    const rules = new InMemoryRulesRepository();
    const productos = new InMemoryProductsRepository();
    const llm = new FakeAgentLLM();
    const flags = new StaticFeatureFlags({ [FLAGS.AI_AGENT_ENABLED]: false });

    const svc = new DefaultAiAgentService(
      sessions,
      new DefaultRuleEngineService(intents, rules),
      new DefaultCatalogMatcherService(productos),
      llm,
      flags,
    );

    const s = await seedSession(sessions);

    const result = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["hola"],
      classification: cls(null),
    });

    expect(result.source).toBe("handoff");
    expect(result.respuesta_contenido).toMatch(/desactivada por flag/i);
    expect(llm.calls).toHaveLength(0);
  });

  test("flag ai_agent.enabled=true permite flow normal", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const intents = new InMemoryIntentsRepository();
    const rules = new InMemoryRulesRepository();
    const productos = new InMemoryProductsRepository();
    const llm = new FakeAgentLLM();
    const flags = new StaticFeatureFlags({ [FLAGS.AI_AGENT_ENABLED]: true });

    const svc = new DefaultAiAgentService(
      sessions,
      new DefaultRuleEngineService(intents, rules),
      new DefaultCatalogMatcherService(productos),
      llm,
      flags,
    );

    const s = await seedSession(sessions);
    llm.enqueueText("respuesta");

    const result = await svc.respond({
      leadSessionId: s.id,
      conversationTurn: ["hola"],
      classification: cls(null),
    });

    expect(result.source).toBe("llm");
  });
});

describe("auto-handoff feature flag", () => {
  test("flag auto_handoff.enabled=false → no pausa aun con 3 nulls", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const handoff = new DefaultHandoffService(sessions);
    const flags = new StaticFeatureFlags({ [FLAGS.AUTO_HANDOFF_ENABLED]: false });

    const s = await seedSession(sessions);

    const result = await autoHandoffHandler(
      {
        leadSessionId: s.id,
        recentClassifications: [cls(null), cls(null), cls(null)],
      },
      { handoff, flags },
    );

    expect(result.paused).toBe(false);
    expect(result.motivo).toMatch(/desactivado/i);
    const post = await sessions.findById(s.id);
    expect(post!.ia_pausada).toBe(false);
  });
});

describe("reactivation-predictor feature flag", () => {
  test("flag reactivation.enabled=false → no dispatch aun con candidatos", async () => {
    const sessions = new InMemoryLeadSessionRepository();
    const NOW = new Date("2026-05-12T00:00:00Z");

    const s = await seedSession(sessions);
    const closed = await sessions.close(s.id, {
      resultado: "perdido" as Resultado,
      motivo_perdida: "precio" as MotivoPerdida,
    });
    const store = (sessions as unknown as { store: Map<string, typeof closed> }).store;
    const cur = store.get(closed.id)!;
    store.set(closed.id, { ...cur, closed_at: new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000) });

    let dispatched = 0;
    const flags = new StaticFeatureFlags({ [FLAGS.REACTIVATION_ENABLED]: false });

    const result = await reactivationPredictorHandler(
      {},
      {
        sessions,
        sendReactivation: async () => {
          dispatched++;
        },
        now: () => NOW,
        flags,
      },
    );

    expect(result.dispatched).toBe(0);
    expect(dispatched).toBe(0);
  });
});
